/**
 * firebase_sync.js - 실시간 판서 동기화 및 획 내부 채움 방지(fill: null) 적용본
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
    // 단일 획 전송 시 내부 채움 속성 제거 보장
    this.canvas.on('path:created', (e) => {
      if (this.isReceivingRemote) return;
      if (!window.whiteboardApp || !window.whiteboardApp.isProfessor) return;

      const pathObj = e.path.toObject();
      pathObj.fill = null; // 전송 전 데이터에서 채움 속성 원천 제거

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

    this.roomRef.child('slides').on('child_added', (slideSnap) => {
      const slideId = slideSnap.key;
      this.roomRef.child(`slides/${slideId}/strokes`).on('child_added', (strokeSnap) => {
        if (this.isReceivingRemote) return;
        const val = strokeSnap.val();
        if (!val || !val.path) return;

        if (this.slideManager.currentSlideId === slideId) {
          // 수신 데이터도 채움을 비운 상태로 강제 지정
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

    this.roomRef.child('canvas_snapshot').on('value', (snap) => {
      const val = snap.val();
      if (!val || this.isReceivingRemote) return;
      if (window.whiteboardApp && window.whiteboardApp.isProfessor) return;

      if (val.slideId === this.slideManager.currentSlideId && val.data) {
        this.isReceivingRemote = true;
        // 스냅샷 복원 시 모든 객체의 fill 속성을 null로 보정
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

    this.roomRef.child('current_theme').on('value', (snap) => {
      const theme = snap.val();
      if (theme && window.whiteboardApp) {
        window.whiteboardApp.setTheme(theme);
        const selectEl = document.getElementById('select-board-theme');
        if (selectEl) selectEl.value = theme;
      }
    });

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