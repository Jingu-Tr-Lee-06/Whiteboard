/**
 * slide_manager.js
 * - 슬라이드 생성, 전환, 상태 저장 관리
 * - 슬라이드 탭 삭제(X) 및 안전 전환 로직 추가
 * - Undo/Redo 제어
 */

class SlideManager {
  constructor(canvas, onThemeChangeCallback) {
    this.canvas = canvas;
    this.onThemeChange = onThemeChangeCallback;
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

    this.historyStack = [];
    this.redoStack = [];
    this.isHistoryProcessing = false;
    this.maxHistorySize = 30;

    this.initCanvasHistoryTracker();
  }

  initCanvasHistoryTracker() {
    const pushState = () => {
      if (this.isHistoryProcessing) return;
      
      const json = JSON.stringify(this.canvas.toJSON());
      this.historyStack.push(json);
      
      if (this.historyStack.length > this.maxHistorySize) {
        this.historyStack.shift();
      }
      
      this.redoStack = [];
      this.saveCurrentSlideData();
    };

    this.canvas.on('object:added', pushState);
    this.canvas.on('object:modified', pushState);
    this.canvas.on('object:removed', pushState);
  }

  saveCurrentSlideData() {
    if (this.slides[this.currentSlideId]) {
      const canvasJson = this.canvas.toJSON();
      if (canvasJson.objects) {
        canvasJson.objects.forEach((obj) => {
          obj.fill = null;
        });
      }
      this.slides[this.currentSlideId].data = canvasJson;
    }
  }

  loadSlideData(slideId) {
    const slide = this.slides[slideId];
    if (!slide) return;

    this.isHistoryProcessing = true;
    this.canvas.clear();
    this.historyStack = [];
    this.redoStack = [];

    if (slide.data && slide.data.objects && slide.data.objects.length > 0) {
      slide.data.objects.forEach((obj) => {
        obj.fill = null;
      });

      this.canvas.loadFromJSON(slide.data, () => {
        this.canvas.renderAll();
        this.isHistoryProcessing = false;
        this.historyStack.push(JSON.stringify(this.canvas.toJSON()));
      });
    } else {
      this.canvas.renderAll();
      this.isHistoryProcessing = false;
      this.historyStack.push(JSON.stringify(this.canvas.toJSON()));
    }

    if (this.onThemeChange) {
      this.onThemeChange(slide.theme || 'chalkboard');
    }
  }

  addNewSlide() {
    this.saveCurrentSlideData();
    this.slideCounter += 1;
    const newId = `slide_${this.slideCounter}`;
    const newTitle = `칠판 ${this.slideCounter}`;

    this.slides[newId] = {
      id: newId,
      title: newTitle,
      theme: 'chalkboard',
      data: { version: '5.3.1', objects: [] }
    };
    this.slideOrder.push(newId);

    this.renderTabs();
    this.switchSlide(newId);

    if (window.whiteboardApp && window.whiteboardApp.firebaseSync) {
      window.whiteboardApp.firebaseSync.broadcastSlidesUpdate(this.slides, newId);
    }
  }

  /**
   * 슬라이드(칠판) 탭 삭제
   */
  deleteSlide(slideId) {
    // 칠판이 1개만 남아있는 경우 삭제 불가
    if (this.slideOrder.length <= 1) {
      alert('최소 1개의 칠판은 유지되어야 합니다.');
      return;
    }

    const slideTitle = this.slides[slideId]?.title || '해당 칠판';
    if (!confirm(`'${slideTitle}'을(를) 삭제하시겠습니까? 판서 내용은 복구되지 않습니다.`)) {
      return;
    }

    const deleteIndex = this.slideOrder.indexOf(slideId);
    delete this.slides[slideId];
    this.slideOrder = this.slideOrder.filter((id) => id !== slideId);

    // Firebase 개별 스트로크 노드 정리
    if (window.whiteboardApp && window.whiteboardApp.firebaseSync) {
      window.whiteboardApp.firebaseSync.roomRef.child(`slides/${slideId}`).remove();
    }

    // 만약 현재 보고 있던 슬라이드를 삭제한 경우, 인접한 슬라이드로 자동 이동
    let targetSlideId = this.currentSlideId;
    if (this.currentSlideId === slideId) {
      const nextIndex = deleteIndex >= this.slideOrder.length ? this.slideOrder.length - 1 : deleteIndex;
      targetSlideId = this.slideOrder[nextIndex];
      this.currentSlideId = targetSlideId;
      this.loadSlideData(targetSlideId);
    }

    this.renderTabs();

    if (window.whiteboardApp && window.whiteboardApp.firebaseSync) {
      window.whiteboardApp.firebaseSync.broadcastSlidesUpdate(this.slides, targetSlideId);
    }
  }

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
   * 탭 렌더링 (교수자에게는 삭제 'x' 버튼 표시)
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

      // 교수자 모드이고 슬라이드가 2개 이상일 때만 삭제(X) 버튼 생성
      if (isProf && this.slideOrder.length > 1) {
        const closeBtn = document.createElement('span');
        closeBtn.className = 'tab-close-btn';
        closeBtn.innerText = '×';
        closeBtn.title = '칠판 삭제';
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation(); // 탭 전환 방지
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

  updateCurrentSlideTheme(theme) {
    if (this.slides[this.currentSlideId]) {
      this.slides[this.currentSlideId].theme = theme;
    }
  }

  undo() {
    if (this.historyStack.length <= 1) return;
    this.isHistoryProcessing = true;
    const currentState = this.historyStack.pop();
    this.redoStack.push(currentState);

    const prevState = this.historyStack[this.historyStack.length - 1];
    const parsedState = JSON.parse(prevState);

    if (parsedState.objects) {
      parsedState.objects.forEach((obj) => {
        obj.fill = null;
      });
    }

    this.canvas.loadFromJSON(parsedState, () => {
      this.canvas.renderAll();
      this.saveCurrentSlideData();
      this.isHistoryProcessing = false;
      if (window.whiteboardApp && window.whiteboardApp.firebaseSync) {
        window.whiteboardApp.firebaseSync.broadcastCurrentState();
      }
    });
  }

  redo() {
    if (this.redoStack.length === 0) return;
    this.isHistoryProcessing = true;
    const nextState = this.redoStack.pop();
    this.historyStack.push(nextState);

    const parsedState = JSON.parse(nextState);
    if (parsedState.objects) {
      parsedState.objects.forEach((obj) => {
        obj.fill = null;
      });
    }

    this.canvas.loadFromJSON(parsedState, () => {
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