/**
 * slide_manager.js - 슬라이드(칠판) 관리, 상태 보관, Undo/Redo 처리 모듈
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

    // 실행 취소 / 다시 실행 스택
    this.historyStack = [];
    this.redoStack = [];
    this.isHistoryProcessing = false;

    this.initCanvasHistoryTracker();
  }

  initCanvasHistoryTracker() {
    const pushState = () => {
      if (this.isHistoryProcessing) return;
      const json = JSON.stringify(this.canvas.toJSON());
      this.historyStack.push(json);
      if (this.historyStack.length > 30) this.historyStack.shift();
      this.redoStack = [];
      this.saveCurrentSlideData();
    };

    this.canvas.on('object:added', pushState);
    this.canvas.on('object:modified', pushState);
    this.canvas.on('object:removed', pushState);
  }

  saveCurrentSlideData() {
    if (this.slides[this.currentSlideId]) {
      this.slides[this.currentSlideId].data = this.canvas.toJSON();
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

  switchSlide(slideId) {
    if (this.currentSlideId === slideId) return;
    this.saveCurrentSlideData();
    this.currentSlideId = slideId;
    this.renderTabs();
    this.loadSlideData(slideId);

    if (window.whiteboardApp && window.whiteboardApp.firebaseSync) {
      window.whiteboardApp.firebaseSync.broadcastActiveSlide(slideId);
    }
  }

  renderTabs() {
    const track = document.getElementById('slide-tabs-scroll');
    if (!track) return;
    track.innerHTML = '';

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
    this.canvas.loadFromJSON(JSON.parse(prevState), () => {
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

    this.canvas.loadFromJSON(JSON.parse(nextState), () => {
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