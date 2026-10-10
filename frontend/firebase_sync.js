/**
 * firebase_sync.js
 * - Firebase Realtime Database 실시간 데이터 동기화
 * - 학생 수신 스트로크 자동 잠금 (selectable: false, evented: false)
 * - 단일 스트로크 실시간 수신 및 학생 기기 마지막 판서 위치 자동 갱신
 * - 슬라이드 생성, 삭제, 전환 원격 실시간 브로드캐스팅
 * - 채움 버그 방지 (전송 전/후 fill: null 보정)
 */

class FirebaseSync {
  constructor(canvas, slideManager) {
    this.canvas = canvas;
    this.slideManager = slideManager;
    this.db = null;
    this.roomId = 'default_room';
    this.roomRef = null;
    this.isReceivingRemote = false;

    this.initFirebase();
  }

  /**
   * Firebase 초기화
   */
  initFirebase() {
    const config = window.FIREBASE_CONFIG;
    if (!config || !config.databaseURL) {
      console.warn('Firebase 설정을 찾을 수 없습니다.');
      return;
    }

    try {
      if (!firebase.apps.length) {
        firebase.initializeApp(config);
      }
      this.db = firebase.database();
      this.roomRef = this.db.ref(`whiteboard_rooms/${this.roomId}`);

      this.setupPresence();
      this.setupLocalCanvasListeners();
      this.setupRemoteListeners();
    } catch (err) {
      console.error('Firebase 초기화 오류:', err);
    }
  }

  /**
   * 동시 접속자 수 집계 (.info/connected 기반)
   */
  setupPresence() {
    if (!this.db) return;

    const connectedRef = this.db.ref('.info/connected');
    const userListRef = this.roomRef.child('active_users');
    const myUserRef = userListRef.push();

    connectedRef.on('value', (snap) => {
      if (snap.val() === true) {
        myUserRef.onDisconnect().remove();
        myUserRef.set({ joinedAt: firebase.database.ServerValue.TIMESTAMP });
      }
    });

    userListRef.on('value', (snap) => {
      const count = snap.numChildren() || 1;
      const countEl = document.getElementById('active-user-count');
      if (countEl) {
        countEl.innerText = `동시 접속: ${count}명`;
      }
    });
  }

  /**
   * 교수자 로컬 판서 이벤트 송신
   */
  setupLocalCanvasListeners() {
    // 1. 단일 스트로크 생성 시 송신 및 마지막 중심점 갱신
    this.canvas.on('path:created', (e) => {
      if (this.isReceivingRemote) return;
      if (!window.whiteboardApp || !window.whiteboardApp.isProfessor) return;

      const pathObj = e.path.toObject();
      pathObj.fill = null;

      const currentSlideId = this.slideManager.currentSlideId;
      const center = e.path.getCenterPoint();

      this.roomRef.child(`slides/${currentSlideId}/strokes`).push({
        action: 'add',
        path: pathObj,
        centerX: center.x,
        centerY: center.y,
        timestamp: firebase.database.ServerValue.TIMESTAMP
      });

      this.slideManager.saveCurrentSlideData();
    });

    // 2. 개체 수정 및 삭제 시 전체 스냅샷 송신
    const broadcastChange = () => {
      if (this.isReceivingRemote) return;
      if (!window.whiteboardApp || !window.whiteboardApp.isProfessor) return;

      this.broadcastCurrentState();
    };

    this.canvas.on('object:modified', broadcastChange);
    this.canvas.on('object:removed', broadcastChange);
  }

  /**
   * 원격 실시간 이벤트 수신
   */
  setupRemoteListeners() {
    if (!this.roomRef) return;

    // 1. 스트로크 단위 실시간 수신 및 학생 기기 마지막 판서 위치 동기화
    this.roomRef.child('slides').on('child_added', (slideSnap) => {
      const slideId = slideSnap.key;
      this.roomRef.child(`slides/${slideId}/strokes`).on('child_added', (strokeSnap) => {
        if (this.isReceivingRemote) return;
        const val = strokeSnap.val();
        if (!val || !val.path) return;

        // 원격 교수자가 작성한 마지막 획 좌표 기록
        if (val.centerX !== undefined && val.centerY !== undefined && window.whiteboardApp) {
          window.whiteboardApp.lastStrokeCenter = {
            x: val.centerX,
            y: val.centerY
          };
        }

        if (this.slideManager.currentSlideId === slideId) {
          val.path.fill = null;
          fabric.util.enlivenObjects([val.path], (objects) => {
            const isProf = window.whiteboardApp && window.whiteboardApp.isProfessor;
            const canSelect = isProf && window.whiteboardApp.toolManager?.currentTool === 'lasso';

            objects.forEach((obj) => {
              // 학생 모드에서는 조작/선택/변형 핸들러 강제 차단
              obj.set({
                fill: null,
                selectable: canSelect,
                evented: canSelect,
                hasControls: canSelect,
                hasBorders: canSelect,
                lockMovementX: !canSelect,
                lockMovementY: !canSelect,
                lockScalingX: !canSelect,
                lockScalingY: !canSelect,
                lockRotation: !canSelect
              });

              const isDuplicate = this.canvas.getObjects().some((o) => {
                return o.left === obj.left && o.top === obj.top && o.path?.length === obj.path?.length;
              });

              if (!isDuplicate) {
                this.isReceivingRemote = true;
                this.canvas.add(obj);
                this.canvas.renderAll();
                this.isReceivingRemote = false;
              }
            });
          });
        }
      });
    });

    // 2. 전체 스냅샷 수신 시 객체 잠금 적용
    this.roomRef.child('canvas_snapshot').on('value', (snap) => {
      const val = snap.val();
      if (!val || this.isReceivingRemote) return;
      if (window.whiteboardApp && window.whiteboardApp.isProfessor) return;

      if (val.slideId === this.slideManager.currentSlideId && val.data) {
        this.isReceivingRemote = true;
        if (val.data.objects) {
          val.data.objects.forEach((obj) => {
            obj.fill = null;
            obj.selectable = false;
            obj.evented = false;
            obj.hasControls = false;
            obj.hasBorders = false;
          });
        }
        this.canvas.loadFromJSON(val.data, () => {
          if (window.whiteboardApp) {
            window.whiteboardApp.updateObjectSelectability();
          }
          this.canvas.renderAll();
          this.isReceivingRemote = false;
        });
      }
    });

    // 3. 테마 동기화 수신
    this.roomRef.child('current_theme').on('value', (snap) => {
      const theme = snap.val();
      if (theme && window.whiteboardApp) {
        window.whiteboardApp.setTheme(theme);
        const selectEl = document.getElementById('select-board-theme');
        if (selectEl) selectEl.value = theme;
      }
    });

    // 4. 슬라이드 전환 동기화 수신
    this.roomRef.child('active_slide_id').on('value', (snap) => {
      const activeId = snap.val();
      if (activeId && this.slideManager.currentSlideId !== activeId) {
        if (this.slideManager.slides[activeId]) {
          this.slideManager.switchSlide(activeId);
        }
      }
    });

    // 5. 슬라이드 메타데이터 동기화 수신 (생성/삭제)
    this.roomRef.child('slide_meta').on('value', (snap) => {
      const meta = snap.val();
      if (meta && meta.slides) {
        this.slideManager.slides = meta.slides;
        this.slideManager.slideOrder = Object.keys(meta.slides);

        if (!this.slideManager.slides[this.slideManager.currentSlideId]) {
          const fallbackId = this.slideManager.slideOrder[0];
          if (fallbackId) {
            this.slideManager.currentSlideId = fallbackId;
            this.slideManager.loadSlideData(fallbackId);
          }
        }

        this.slideManager.renderTabs();
      }
    });
  }

  removeSlideNode(slideId) {
    if (!this.roomRef) return;
    this.roomRef.child(`slides/${slideId}`).remove();
  }

  broadcastCurrentState() {
    if (!this.roomRef) return;
    const currentSlideId = this.slideManager.currentSlideId;
    const canvasData = this.canvas.toJSON();

    if (canvasData.objects) {
      canvasData.objects.forEach((obj) => {
        obj.fill = null;
      });
    }

    this.roomRef.child('canvas_snapshot').set({
      slideId: currentSlideId,
      data: canvasData,
      timestamp: firebase.database.ServerValue.TIMESTAMP
    });

    this.slideManager.saveCurrentSlideData();
  }

  broadcastClear() {
    if (!this.roomRef) return;
    const currentSlideId = this.slideManager.currentSlideId;
    this.roomRef.child(`slides/${currentSlideId}/strokes`).remove();
    this.broadcastCurrentState();
  }

  broadcastCurrentTheme(theme) {
    if (!this.roomRef) return;
    this.roomRef.child('current_theme').set(theme);
  }

  broadcastActiveSlide(slideId) {
    if (!this.roomRef) return;
    this.roomRef.child('active_slide_id').set(slideId);
  }

  broadcastSlidesUpdate(slides, activeId) {
    if (!this.roomRef) return;
    this.roomRef.child('slide_meta').set({
      slides: slides,
      timestamp: firebase.database.ServerValue.TIMESTAMP
    });
    this.broadcastActiveSlide(activeId);
  }
}

window.FirebaseSync = FirebaseSync;