/**
 * slide_manager.js - 완전 재설계 버전
 * - 칠판(슬라이드) CRUD (생성, 조회, 전환, 삭제)
 * - 칠판 탭 삭제(X) 시 인접 슬라이드 자동 이동 및 안전 처리
 * - Undo/Redo 기록 시 채움 속성 제거 (fill: null 강제)
 * - 슬라이드 전환 시 줌/패닝 뷰포트 상태 보존 및 리셋 관리
 */

class SlideManager {
  constructor(canvas, onThemeChangeCallback) {
    this.canvas = canvas;
    this.onThemeChange = onThemeChangeCallback;
    
    // 초기 슬라이드 상태
    this.slides = {
      slide_1: {
        id: 'slide_1',
        title: '칠판 1',
        theme: 'chalkboard',
        data: { version: '5.3.1', objects: [] }
      }
    };
    this.currentSlideId = 'slide_1';
    this.slideOrder = ['slide_1'];
    this.slideCounter = 1;

    // Undo / Redo 스택
    this.historyStack = [];
    this.redoStack = [];
    this.isHistoryProcessing = false;
    this.maxHistorySize = 30;

    this.initHistoryTracker();
  }

  /**
   * 캔버스 객체 변동 감지 및 히스토리 푸시
   */
  initHistoryTracker() {
    const recordState = () => {
      if (this.isHistoryProcessing) return;

      const stateJson = JSON.stringify(this.canvas.toJSON());
      this.historyStack.push(stateJson);

      if (this.historyStack.length > this.maxHistorySize) {
        this.historyStack.shift();
      }

      this.redoStack = [];
      this.saveCurrentSlideData();
    };

    this.canvas.on('object:added', recordState);
    this.canvas.on('object:modified', recordState);
    this.canvas.on('object:removed', recordState);
  }

  /**
   * 현재 캔버스 데이터를 현재 슬라이드에 저장
   */
  saveCurrentSlideData() {
    if (!this.slides[this.currentSlideId]) return;

    const canvasJson = this.canvas.toJSON();
    if (canvasJson.objects) {
      canvasJson.objects.forEach((obj) => {
        obj.fill = null;
      });
    }

    this.slides[this.currentSlideId].data = canvasJson;
  }

  /**
   * 대상 슬라이드 캔버스에 로드
   */
  loadSlideData(slideId, callback) {
    const slide = this.slides[slideId];
    if (!slide) return;

    this.isHistoryProcessing = true;
    this.canvas.clear();
    this.historyStack = [];
    this.redoStack = [];

    // 뷰포트 줌/패닝 초기화
    this.canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);

    if (slide.data && slide.data.objects && slide.data.objects.length > 0) {
      slide.data.objects.forEach((obj) => {
        obj.fill = null;
      });

      this.canvas.loadFromJSON(slide.data, () => {
        this.canvas.renderAll();
        this.isHistoryProcessing = false;
        this.historyStack.push(JSON.stringify(this.canvas.toJSON()));
        if (callback) callback();
      });
    } else {
      this.canvas.renderAll();
      this.isHistoryProcessing = false;
      this.historyStack.push(JSON.stringify(this.canvas.toJSON()));
      if (callback) callback();
    }

    if (this.onThemeChange) {
      this.onThemeChange(slide.theme || 'chalkboard');
    }
  }

  /**
   * 새 칠판 슬라이드 추가
   */
  addNewSlide() {
    this.saveCurrentSlideData();
    this.slideCounter += 1;
    const newId = `slide_${this.slideCounter}`;
    const newTitle = `칠판 ${this.slideCounter}`;

    const currentTheme = this.slides[this.currentSlideId]?.theme || 'chalkboard';

    this.slides[newId] = {
      id: newId,
      title: newTitle,
      theme: currentTheme,
      data: { version: '5.3.1', objects: [] }
    };
    this.slideOrder.push(newId);

    this.renderTabs();
    this.switchSlide(newId);

    // Firebase 동기화
    if (window.whiteboardApp && window.whiteboardApp.firebaseSync) {
      window.whiteboardApp.firebaseSync.broadcastSlidesUpdate(this.slides, newId);
    }
  }

  /**
   * 칠판 슬라이드 삭제
   */
  deleteSlide(slideId) {
    if (this.slideOrder.length <= 1) {
      alert('칠판은 최소 1개 이상 존재해야 합니다.');
      return;
    }

    const slideTitle = this.slides[slideId]?.title || '해당 칠판';
    if (!confirm(`'${slideTitle}'을(를) 완전히 삭제하시겠습니까?`)) {
      return;
    }

    const deleteIndex = this.slideOrder.indexOf(slideId);
    delete this.slides[slideId];
    this.slideOrder = this.slideOrder.filter((id) => id !== slideId);

    // 원격 Firebase 노드 정리
    if (window.whiteboardApp && window.whiteboardApp.firebaseSync) {
      window.whiteboardApp.firebaseSync.removeSlideNode(slideId);
    }

    // 보고 있던 슬라이드를 삭제한 경우 대체 슬라이드로 전환
    let nextActiveId = this.currentSlideId;
    if (this.currentSlideId === slideId) {
      const fallbackIndex = deleteIndex >= this.slideOrder.length ? this.slideOrder.length - 1 : deleteIndex;
      nextActiveId = this.slideOrder[fallbackIndex];
      this.currentSlideId = nextActiveId;
      this.loadSlideData(nextActiveId);
    }

    this.renderTabs();

    if (window.whiteboardApp && window.whiteboardApp.firebaseSync) {
      window.whiteboardApp.firebaseSync.broadcastSlidesUpdate(this.slides, nextActiveId);
    }
  }

  /**
   * 슬라이드 전환
   */
  switchSlide(slideId) {
    if (!this.slides[slideId]) return;
    if (this.currentSlideId === slideId) return;

    this.saveCurrentSlideData();
    this.currentSlideId = slideId;
    this.renderTabs();
    this.loadSlideData(slideId);

    if (window.whiteboardApp && window.whiteboardApp.firebaseSync) {
      window.whiteboardApp.firebaseSync.broadcastActiveSlide(slideId);
    }
  }

  /**
   * 하단 슬라이드 탭 렌더링
   */
  renderTabs() {
    const track = document.getElementById('slide-tabs-scroll');
    if (!track) return;
    track.innerHTML = '';

    const isProf = window.whiteboardApp ? window.whiteboardApp.isProfessor : false;

    this.slideOrder.forEach((id) => {
      const slide = this.slides[id];
      if (!slide) return;

      const tabEl = document.createElement('div');
      tabEl.className = `slide-tab-item ${id === this.currentSlideId ? 'active' : ''}`;
      tabEl.dataset.slideId = id;

      const label = document.createElement('span');
      label.className = 'tab-label';
      label.innerText = slide.title;
      tabEl.appendChild(label);

      // 교수자 권한이며 2개 이상일 때만 삭제 버튼 표시
      if (isProf && this.slideOrder.length > 1) {
        const closeBtn = document.createElement('span');
        closeBtn.className = 'tab-close-btn';
        closeBtn.innerText = '×';
        closeBtn.title = '칠판 삭제';
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation(); // 탭 이동 이벤트 방지
          this.deleteSlide(id);
        });
        tabEl.appendChild(closeBtn);
      }

      tabEl.addEventListener('click', () => {
        this.switchSlide(id);
      });

      track.appendChild(tabEl);
    });
  }

  /**
   * 테마 변경 반영
   */
  updateCurrentSlideTheme(theme) {
    if (this.slides[this.currentSlideId]) {
      this.slides[this.currentSlideId].theme = theme;
    }
  }

  /**
   * 실행 취소 (Undo)
   */
  undo() {
    if (this.historyStack.length <= 1) return;

    this.isHistoryProcessing = true;
    const currentState = this.historyStack.pop();
    this.redoStack.push(currentState);

    const prevState = this.historyStack[this.historyStack.length - 1];
    const parsed = JSON.parse(prevState);

    if (parsed.objects) {
      parsed.objects.forEach((obj) => {
        obj.fill = null;
      });
    }

    this.canvas.loadFromJSON(parsed, () => {
      this.canvas.renderAll();
      this.saveCurrentSlideData();
      this.isHistoryProcessing = false;

      if (window.whiteboardApp && window.whiteboardApp.firebaseSync) {
        window.whiteboardApp.firebaseSync.broadcastCurrentState();
      }
    });
  }

  /**
   * 다시 실행 (Redo)
   */
  redo() {
    if (this.redoStack.length === 0) return;

    this.isHistoryProcessing = true;
    const nextState = this.redoStack.pop();
    this.historyStack.push(nextState);

    const parsed = JSON.parse(nextState);
    if (parsed.objects) {
      parsed.objects.forEach((obj) => {
        obj.fill = null;
      });
    }

    this.canvas.loadFromJSON(parsed, () => {
      this.canvas.renderAll();
      this.saveCurrentSlideData();
      this.isHistoryProcessing = false;

      if (window.whiteboardApp && window.whiteboardApp.firebaseSync) {
        window.whiteboardApp.firebaseSync.broadcastCurrentState();
      }
    });
  }
}

window.SlideManager = SlideManager;