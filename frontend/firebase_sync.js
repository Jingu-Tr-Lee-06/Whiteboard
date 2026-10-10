/**
 * firebase_sync.js
 * - Firebase Realtime Database 실시간 통신 엔진
 * - 접속자 수 세션 집계
 * - 획(Stroke) 단위 및 스냅샷 단위 동기화 (fill: null 보정 유지)
 * - 칠판 탭 추가/삭제/전환 실시간 원격 반영
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

  setupCanvasListeners() {
    this.canvas.on('path:created', (e) => {
      if (this.isReceivingRemote) return;
      if (!window.whiteboardApp || !window.whiteboardApp.isProfessor) return;

      const pathObj = e.path.toObject();
      pathObj.fill = null;

      const currentSlideId = this.slideManager.currentSlideId;

      this.roomRef.child(`slides/${currentSlideId}/strokes`).push({
        action: 'add',
        path: pathObj,
        timestamp: firebase.database.ServerValue.TIMESTAMP
      });

      this.slideManager.saveCurrentSlideData();
    });

    const handleObjectChange = () => {
      if (this.isReceivingRemote) return;
      if (!window.whiteboardApp || !window.whiteboardApp.isProfessor) return;

      this.broadcastCurrentState();
    };

    this.canvas.on('object:modified', handleObjectChange);
    this.canvas.on('object:removed', handleObjectChange);
  }

  setupRemoteListeners() {
    if (!this.roomRef) return;

    // 1. 단일 스트로크 실시간 수신
    this.roomRef.child('slides').on('child_added', (slideSnap) => {
      const slideId = slideSnap.key;
      this.roomRef.child(`slides/${slideId}/strokes`).on('child_added', (strokeSnap) => {
        if (this.isReceivingRemote) return;
        const val = strokeSnap.val();
        if (!val || !val.path) return;

        if (this.slideManager.currentSlideId === slideId) {
          val.path.fill = null;
          fabric.util.enlivenObjects([val.path], (objects) => {
            objects.forEach((obj) => {
              obj.set({ fill: null });
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

    // 2. 스냅샷 동기화
    this.roomRef.child('canvas_snapshot').on('value', (snap) => {
      const val = snap.val();
      if (!val || this.isReceivingRemote) return;
      if (window.whiteboardApp && window.whiteboardApp.isProfessor) return;

      if (val.slideId === this.slideManager.currentSlideId && val.data) {
        this.isReceivingRemote = true;
        if (val.data.objects) {
          val.data.objects.forEach((obj) => {
            obj.fill = null;
          });
        }
        this.canvas.loadFromJSON(val.data, () => {
          this.canvas.renderAll();
          this.isReceivingRemote = false;
        });
      }
    });

    // 3. 테마 동기화
    this.roomRef.child('current_theme').on('value', (snap) => {
      const theme = snap.val();
      if (theme && window.whiteboardApp) {
        window.whiteboardApp.setTheme(theme);
        const selectEl = document.getElementById('select-board-theme');
        if (selectEl) selectEl.value = theme;
      }
    });

    // 4. 활성 슬라이드 전환 동기화
    this.roomRef.child('active_slide_id').on('value', (snap) => {
      const activeId = snap.val();
      if (activeId && this.slideManager.currentSlideId !== activeId) {
        if (this.slideManager.slides[activeId]) {
          this.slideManager.switchSlide(activeId);
        }
      }
    });

    // 5. 슬라이드 목록(생성/삭제) 동기화
    this.roomRef.child('slide_meta').on('value', (snap) => {
      const meta = snap.val();
      if (meta && meta.slides) {
        this.slideManager.slides = meta.slides;
        this.slideManager.slideOrder = Object.keys(meta.slides);

        // 현재 보고 있던 슬라이드가 원격에서 삭제된 경우 남아있는 슬라이드로 전환
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