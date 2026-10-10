/**
 * firebase_sync.js - Firebase Realtime Database 실시간 판서 스트리밍 및 동기화 모듈
 * Streamlit secrets.toml 주입 객체(window.__FIREBASE_CONFIG__)를 기반으로 동적 초기화
 */

class FirebaseSyncManager {
  constructor() {
    this.db = null;
    this.roomId = 'class_main_room';
    this.role = 'student'; // 'prof' | 'student'
    this.canvas = null;
    this.currentSlideId = 'slide_1';
    this.isRemoteUpdating = false;
  }

  /**
   * Firebase 초기화 및 인스턴스 연결
   */
  init(canvas, role = 'student') {
    this.canvas = canvas;
    this.role = role;

    // Streamlit app.py에서 secrets.toml을 읽어 window 전역 객체로 주입한 설정 참조
    const config = window.__FIREBASE_CONFIG__;

    if (!config || !config.apiKey || config.apiKey.includes('YOUR_FIREBASE')) {
      console.warn("유효한 Firebase 설정(secrets.toml)이 감지되지 않았습니다. 오프라인 단독 모드로 동작합니다.");
      return;
    }

    // Firebase 중복 초기화 방지
    if (!firebase.apps.length) {
      try {
        firebase.initializeApp(config);
      } catch (e) {
        console.error("Firebase 초기화 에러:", e);
        return;
      }
    }

    try {
      this.db = firebase.database();
      this.setupPresence();
      this.setupListeners();
    } catch (e) {
      console.error("Firebase RTDB 연결 에러:", e);
    }
  }

  setRole(newRole) {
    this.role = newRole;
  }

  setCurrentSlide(slideId) {
    this.currentSlideId = slideId;
    if (this.role === 'prof' && this.db) {
      // 교수자가 슬라이드를 전환하면 학생들의 뷰포트도 함께 이동하도록 동기화
      this.db.ref(`rooms/${this.roomId}/activeSlideId`).set(slideId);
    }
  }

  /**
   * 동시 접속자 수 카운팅 및 연결 감지 (.info/connected)
   */
  setupPresence() {
    if (!this.db) return;

    const connectedRef = this.db.ref('.info/connected');
    const myPresenceRef = this.db.ref(`rooms/${this.roomId}/users`).push();

    connectedRef.on('value', (snap) => {
      if (snap.val() === true) {
        myPresenceRef.onDisconnect().remove();
        myPresenceRef.set({
          role: this.role,
          joinedAt: firebase.database.ServerValue.TIMESTAMP
        });
      }
    });

    // 접속자 수 UI 실시간 갱신
    this.db.ref(`rooms/${this.roomId}/users`).on('value', (snap) => {
      const users = snap.val() || {};
      const count = Object.keys(users).length;
      const countEl = document.getElementById('active-user-count');
      if (countEl) {
        countEl.textContent = `동시 접속: ${count}명`;
      }
    });
  }

  /**
   * 실시간 이벤트 리스너 등록
   */
  setupListeners() {
    if (!this.db) return;

    // 1. 활성 슬라이드 전환 감지 (학생 동기화)
    this.db.ref(`rooms/${this.roomId}/activeSlideId`).on('value', (snap) => {
      const targetSlideId = snap.val();
      if (targetSlideId && targetSlideId !== this.currentSlideId) {
        this.currentSlideId = targetSlideId;
        if (window.slideManager) {
          window.slideManager.switchSlide(targetSlideId, false);
        }
      }
    });

    // 2. 단일 획(Stroke) 실시간 드로잉 패스 수신
    this.db.ref(`rooms/${this.roomId}/strokes/${this.currentSlideId}`).on('child_added', (snap) => {
      const strokeData = snap.val();
      if (!strokeData) return;

      // 자신이 보낸 획이 아니거나 학생 모드일 때만 캔버스에 추가
      if (strokeData.senderRole !== this.role || this.role === 'student') {
        this.renderRemoteStroke(strokeData);
      }
    });

    // 3. 칠판 전체 초기화(Clear) 신호 감지
    this.db.ref(`rooms/${this.roomId}/actions/${this.currentSlideId}`).on('value', (snap) => {
      const action = snap.val();
      if (action && action.type === 'clear') {
        this.isRemoteUpdating = true;
        this.canvas.clear();
        this.canvas.requestRenderAll();
        this.isRemoteUpdating = false;
      }
    });
  }

  /**
   * [교수자 전용] 완성된 획(Fabric Path)을 Firebase에 전송
   */
  broadcastStroke(pathObject) {
    if (this.role !== 'prof' || !this.db || this.isRemoteUpdating) return;

    const strokeJson = pathObject.toObject();
    const payload = {
      senderRole: this.role,
      data: strokeJson,
      timestamp: firebase.database.ServerValue.TIMESTAMP
    };

    this.db.ref(`rooms/${this.roomId}/strokes/${this.currentSlideId}`).push(payload);
  }

  /**
   * [교수자 전용] 칠판 전체 삭제 명령 전파
   */
  broadcastClear() {
    if (this.role !== 'prof' || !this.db) return;

    this.db.ref(`rooms/${this.roomId}/strokes/${this.currentSlideId}`).remove();
    this.db.ref(`rooms/${this.roomId}/actions/${this.currentSlideId}`).set({
      type: 'clear',
      timestamp: firebase.database.ServerValue.TIMESTAMP
    });
  }

  /**
   * [교수자 전용] 칠판 전체 상태 저장 (슬라이드 탭 전환 시 영구 보관)
   */
  saveSlideData(slideId, canvasData, theme) {
    if (this.role !== 'prof' || !this.db) return;

    this.db.ref(`rooms/${this.roomId}/slides/${slideId}`).set({
      id: slideId,
      data: canvasData,
      theme: theme,
      updatedAt: firebase.database.ServerValue.TIMESTAMP
    });
  }

  /**
   * [학생 전용] 수신한 원격 획 렌더링
   */
  renderRemoteStroke(strokePayload) {
    if (!this.canvas || !strokePayload.data) return;

    this.isRemoteUpdating = true;
    fabric.util.enlivenObjects([strokePayload.data], (enlivenedObjects) => {
      enlivenedObjects.forEach((obj) => {
        obj.selectable = false;
        obj.evented = false;
        this.canvas.add(obj);
      });
      this.canvas.requestRenderAll();
      this.isRemoteUpdating = false;
    });
  }
}

// 전역 싱글톤 인스턴스 노출
window.firebaseSyncManager = new FirebaseSyncManager();