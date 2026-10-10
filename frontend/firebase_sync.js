/**
 * firebase_sync.js - Firebase Realtime Database 실시간 판서 및 세션 동기화 엔진
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

  initFirebase() {
    // Streamlit 전달 설정 객체 확인
    const config = window.FIREBASE_CONFIG;
    if (!config || !config.databaseURL) {
      console.warn('Firebase 설정(FIREBASE_CONFIG)을 찾을 수 없습니다.');
      return;
    }

    try {
      if (!firebase.apps.length) {
        firebase.initializeApp(config);
      }
      this.db = firebase.database();
      this.roomRef = this.db.ref(`whiteboard_rooms/${this.roomId}`);

      this.setupPresence();
      this.setupCanvasListeners();
      this.setupRemoteListeners();
    } catch (err) {
      console.error('Firebase 초기화 오류:', err);
    }
  }

  /**
   * 동시 접속자 수 실시간 집계 (.info/connected 기반)
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
   * 로컬 캔버스 변경 이벤트를 감지하여 데이터베이스로 송신
   */
  setupCanvasListeners() {
    // 1. 단일 획 완성 시 즉시 전송
    this.canvas.on('path:created', (e) => {
      if (this.isReceivingRemote) return;
      if (!window.whiteboardApp || !window.whiteboardApp.isProfessor) return;

      const pathObj = e.path.toObject();
      const currentSlideId = this.slideManager.currentSlideId;

      this.roomRef.child(`slides/${currentSlideId}/strokes`).push({
        action: 'add',
        path: pathObj,
        timestamp: firebase.database.ServerValue.TIMESTAMP
      });

      this.slideManager.saveCurrentSlideData();
    });

    // 2. 객체 삭제, 이동, 올가미 수정 시 현재 슬라이드 전체 스냅샷 동기화
    const handleObjectChange = () => {
      if (this.isReceivingRemote) return;
      if (!window.whiteboardApp || !window.whiteboardApp.isProfessor) return;

      this.broadcastCurrentState();
    };

    this.canvas.on('object:modified', handleObjectChange);
    this.canvas.on('object:removed', handleObjectChange);
  }

  /**
   * 원격 변경 사항을 수신하여 로컬 캔버스에 즉각 반영
   */
  setupRemoteListeners() {
    if (!this.roomRef) return;

    // 1. 개별 획 추가 실시간 수신
    this.roomRef.child('slides').on('child_added', (slideSnap) => {
      const slideId = slideSnap.key;
      this.roomRef.child(`slides/${slideId}/strokes`).on('child_added', (strokeSnap) => {
        if (this.isReceivingRemote) return;
        const val = strokeSnap.val();
        if (!val || !val.path) return;

        // 현재 보고 있는 슬라이드인 경우에만 렌더링
        if (this.slideManager.currentSlideId === slideId) {
          fabric.util.enlivenObjects([val.path], (objects) => {
            objects.forEach((obj) => {
              // 이미 존재하는 객체와 중복되지 않도록 방지
              const exists = this.canvas.getObjects().some((o) => {
                return o.left === obj.left && o.top === obj.top && o.path?.length === obj.path?.length;
              });

              if (!exists) {
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

    // 2. 전체 스냅샷 갱신 수신 (지우개 일괄 삭제, 초기화 등)
    this.roomRef.child('canvas_snapshot').on('value', (snap) => {
      const val = snap.val();
      if (!val || this.isReceivingRemote) return;

      // 자신이 보낸 이벤트는 무시
      if (window.whiteboardApp && window.whiteboardApp.isProfessor) return;

      if (val.slideId === this.slideManager.currentSlideId && val.data) {
        this.isReceivingRemote = true;
        this.canvas.loadFromJSON(val.data, () => {
          this.canvas.renderAll();
          this.isReceivingRemote = false;
        });
      }
    });

    // 3. 테마 변경 동기화 수신
    this.roomRef.child('current_theme').on('value', (snap) => {
      const theme = snap.val();
      if (theme && window.whiteboardApp) {
        window.whiteboardApp.setTheme(theme);
        const selectEl = document.getElementById('select-board-theme');
        if (selectEl) selectEl.value = theme;
      }
    });

    // 4. 슬라이드 탭 구조 및 활성 슬라이드 전환 수신
    this.roomRef.child('active_slide_id').on('value', (snap) => {
      const activeId = snap.val();
      if (activeId && this.slideManager.currentSlideId !== activeId) {
        this.slideManager.switchSlide(activeId);
      }
    });

    this.roomRef.child('slide_meta').on('value', (snap) => {
      const meta = snap.val();
      if (meta && meta.slides) {
        this.slideManager.slides = meta.slides;
        this.slideManager.slideOrder = Object.keys(meta.slides);
        this.slideManager.renderTabs();
      }
    });
  }

  broadcastCurrentState() {
    if (!this.roomRef) return;
    const currentSlideId = this.slideManager.currentSlideId;
    const canvasData = this.canvas.toJSON();

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