/**
 * tools.js - 판서 도구 및 상태 관리 모듈
 * 펜, 지우개(획/영역), 올가미 선택, 테마 프리셋, Undo/Redo 제어
 */

class ToolManager {
  constructor() {
    this.canvas = null;
    this.currentTool = 'pen'; // 'pen' | 'eraser' | 'lasso'
    this.eraserMode = 'stroke'; // 'stroke' | 'area'
    
    // 테마별 색상 프리셋 사양
    this.themePresets = {
      chalkboard: ['#FFFFFF', '#FFEE58', '#FF8A80'], // 분필 흰색, 노랑, 분홍
      whiteboard: ['#212121', '#1976D2', '#D32F2F'], // 보드마카 검정, 파랑, 빨강
      blackboard: ['#FFFFFF', '#69F0AE', '#40C4FF']  // 네온 흰색, 연두, 하늘
    };

    this.currentTheme = 'chalkboard';
    this.currentColor = '#FFFFFF';
    this.penSize = 4;
    this.eraserSize = 24;

    // Undo / Redo 스택
    this.undoStack = [];
    this.redoStack = [];
    this.isHistoryProcessing = false;
  }

  /**
   * Fabric.js Canvas 인스턴스 바인딩 및 초기화
   */
  init(fabricCanvas) {
    this.canvas = fabricCanvas;
    this.bindDOM();
    this.applyTheme(this.currentTheme);
    this.setTool('pen');
    this.setupHistoryListener();
  }

  /**
   * DOM 요소 이벤트 리스너 바인딩
   */
  bindDOM() {
    // 도구 선택 버튼
    const btnPen = document.getElementById('btn-tool-pen');
    const btnEraser = document.getElementById('btn-tool-eraser');
    const btnLasso = document.getElementById('btn-tool-lasso');

    btnPen.addEventListener('click', () => this.setTool('pen'));
    btnEraser.addEventListener('click', () => this.setTool('eraser'));
    btnLasso.addEventListener('click', () => this.setTool('lasso'));

    // 지우개 모드 (획 지우기 / 영역 지우기)
    const btnStroke = document.getElementById('btn-erase-stroke');
    const btnArea = document.getElementById('btn-erase-area');

    btnStroke.addEventListener('click', () => this.setEraserMode('stroke'));
    btnArea.addEventListener('click', () => this.setEraserMode('area'));

    // 두께 슬라이더
    const slider = document.getElementById('size-slider');
    const sliderVal = document.getElementById('size-display-val');

    slider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      sliderVal.textContent = `${val}px`;
      if (this.currentTool === 'pen') {
        this.penSize = val;
        this.canvas.freeDrawingBrush.width = val;
      } else if (this.currentTool === 'eraser') {
        this.eraserSize = val;
        this.canvas.freeDrawingBrush.width = val;
      }
    });

    // 커스텀 컬러 피커
    const customPicker = document.getElementById('custom-color-picker');
    customPicker.addEventListener('input', (e) => {
      this.setColor(e.target.value);
      this.clearPresetActive();
    });

    // 테마 셀렉터
    const themeSelect = document.getElementById('select-board-theme');
    themeSelect.addEventListener('change', (e) => {
      this.applyTheme(e.target.value);
    });

    // 실행 취소 / 다시 실행
    document.getElementById('btn-action-undo').addEventListener('click', () => this.undo());
    document.getElementById('btn-action-redo').addEventListener('click', () => this.redo());

    // 초기화
    document.getElementById('btn-action-clear').addEventListener('click', () => {
      if (confirm('현재 칠판의 모든 판서 내용을 삭제하시겠습니까?')) {
        this.clearCanvas();
      }
    });
  }

  /**
   * 도구 전환 (펜, 지우개, 올가미)
   */
  setTool(tool) {
    this.currentTool = tool;

    // UI 활성화 상태 토글
    document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
    const targetBtn = document.querySelector(`.tool-btn[data-tool="${tool}"]`);
    if (targetBtn) targetBtn.classList.add('active');

    const penSettings = document.getElementById('pen-settings');
    const eraserSettings = document.getElementById('eraser-settings');
    const slider = document.getElementById('size-slider');
    const sliderVal = document.getElementById('size-display-val');

    if (tool === 'pen') {
      penSettings.style.display = 'flex';
      eraserSettings.style.display = 'none';
      slider.value = this.penSize;
      sliderVal.textContent = `${this.penSize}px`;

      this.canvas.isDrawingMode = true;
      this.canvas.selection = false;
      this.canvas.defaultCursor = 'crosshair';

      // 펜 브러시 적용
      const brush = new fabric.PencilBrush(this.canvas);
      brush.color = this.currentColor;
      brush.width = this.penSize;
      this.canvas.freeDrawingBrush = brush;

    } else if (tool === 'eraser') {
      penSettings.style.display = 'none';
      eraserSettings.style.display = 'flex';
      slider.value = this.eraserSize;
      sliderVal.textContent = `${this.eraserSize}px`;

      this.canvas.selection = false;
      this.setupEraserMode();

    } else if (tool === 'lasso') {
      penSettings.style.display = 'none';
      eraserSettings.style.display = 'none';

      // 올가미/선택 모드 활성화
      this.canvas.isDrawingMode = false;
      this.canvas.selection = true;
      this.canvas.defaultCursor = 'default';

      // 모든 객체 선택 및 이동 허용
      this.canvas.forEachObject((obj) => {
        obj.selectable = true;
        obj.evented = true;
      });
    }
  }

  /**
   * 지우개 서브 모드 (획 / 영역) 설정
   */
  setEraserMode(mode) {
    this.eraserMode = mode;
    document.getElementById('btn-erase-stroke').classList.toggle('active', mode === 'stroke');
    document.getElementById('btn-erase-area').classList.toggle('active', mode === 'area');
    if (this.currentTool === 'eraser') {
      this.setupEraserMode();
    }
  }

  setupEraserMode() {
    if (this.eraserMode === 'stroke') {
      // 획 지우기: 포인터가 닿는 개별 객체(Path) 자체를 즉시 소멸
      this.canvas.isDrawingMode = false;
      this.canvas.defaultCursor = 'pointer';
      this.attachStrokeEraserEvents();
    } else {
      // 영역 지우기: 배경색으로 덮어 칠하는 드로잉 브러시 적용
      this.canvas.isDrawingMode = true;
      this.canvas.defaultCursor = 'cell';
      const bgColor = this.getThemeBgColor();
      const brush = new fabric.PencilBrush(this.canvas);
      brush.color = bgColor;
      brush.width = this.eraserSize;
      this.canvas.freeDrawingBrush = brush;
      this.detachStrokeEraserEvents();
    }
  }

  /**
   * 획 지우개 이벤트 바인딩 (인터섹션 검사)
   */
  attachStrokeEraserEvents() {
    this.detachStrokeEraserEvents();
    this._strokeEraserDown = false;

    this._onMouseDown = (opt) => {
      if (this.currentTool === 'eraser' && this.eraserMode === 'stroke') {
        this._strokeEraserDown = true;
        this.eraseIntersectedObject(opt);
      }
    };

    this._onMouseMove = (opt) => {
      if (this._strokeEraserDown && this.currentTool === 'eraser' && this.eraserMode === 'stroke') {
        this.eraseIntersectedObject(opt);
      }
    };

    this._onMouseUp = () => {
      this._strokeEraserDown = false;
    };

    this.canvas.on('mouse:down', this._onMouseDown);
    this.canvas.on('mouse:move', this._onMouseMove);
    this.canvas.on('mouse:up', this._onMouseUp);
  }

  detachStrokeEraserEvents() {
    if (this._onMouseDown) {
      this.canvas.off('mouse:down', this._onMouseDown);
      this.canvas.off('mouse:move', this._onMouseMove);
      this.canvas.off('mouse:up', this._onMouseUp);
    }
  }

  eraseIntersectedObject(opt) {
    const pointer = this.canvas.getPointer(opt.e);
    const objects = this.canvas.getObjects();

    for (let i = objects.length - 1; i >= 0; i--) {
      const obj = objects[i];
      if (obj.containsPoint(pointer)) {
        this.canvas.remove(obj);
        this.canvas.requestRenderAll();
        this.pushHistoryState();
        break;
      }
    }
  }

  /**
   * 펜 색상 지정 및 프리셋 버튼 UI 동기화
   */
  setColor(hexColor) {
    this.currentColor = hexColor;
    if (this.canvas && this.canvas.freeDrawingBrush && this.currentTool === 'pen') {
      this.canvas.freeDrawingBrush.color = hexColor;
    }
  }

  clearPresetActive() {
    document.querySelectorAll('.color-preset-btn').forEach(btn => btn.classList.remove('active'));
  }

  /**
   * 칠판 테마 적용 및 색상 프리셋 3종 자동 교체
   */
  applyTheme(themeKey) {
    this.currentTheme = themeKey;
    document.body.className = `theme-${themeKey}`;

    const selectElem = document.getElementById('select-board-theme');
    if (selectElem) selectElem.value = themeKey;

    const presets = this.themePresets[themeKey] || this.themePresets.chalkboard;
    const presetButtons = document.querySelectorAll('.color-preset-btn');

    presetButtons.forEach((btn, index) => {
      const color = presets[index];
      btn.style.backgroundColor = color;
      btn.setAttribute('data-color', color);

      // 기존 리스너 교체를 위한 cloneNode 트릭
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);

      newBtn.addEventListener('click', () => {
        this.clearPresetActive();
        newBtn.classList.add('active');
        this.setColor(color);
      });
    });

    // 첫 번째 프리셋을 기본 활성 색상으로 설정
    const firstBtn = document.querySelectorAll('.color-preset-btn')[0];
    if (firstBtn) {
      this.clearPresetActive();
      firstBtn.classList.add('active');
      this.setColor(presets[0]);
    }

    // 영역 지우개 모드 중이면 배경색 즉시 갱신
    if (this.currentTool === 'eraser' && this.eraserMode === 'area') {
      this.canvas.freeDrawingBrush.color = this.getThemeBgColor();
    }
  }

  getThemeBgColor() {
    switch (this.currentTheme) {
      case 'whiteboard': return '#f8f9fa';
      case 'blackboard': return '#121212';
      case 'chalkboard':
      default:
        return '#1e3d2f';
    }
  }

  /**
   * Undo / Redo 히스토리 제어
   */
  setupHistoryListener() {
    this.canvas.on('object:added', () => {
      if (!this.isHistoryProcessing) this.pushHistoryState();
    });
    this.canvas.on('object:modified', () => {
      if (!this.isHistoryProcessing) this.pushHistoryState();
    });
    this.canvas.on('object:removed', () => {
      if (!this.isHistoryProcessing) this.pushHistoryState();
    });
  }

  pushHistoryState() {
    if (this.isHistoryProcessing) return;
    const jsonState = JSON.stringify(this.canvas.toJSON());
    this.undoStack.push(jsonState);
    this.redoStack = []; // 새 작업 시 redo 스택 비움

    // 최대 30개 히스토리 유지
    if (this.undoStack.length > 30) {
      this.undoStack.shift();
    }
  }

  undo() {
    if (this.undoStack.length <= 1) {
      if (this.undoStack.length === 1) {
        this.redoStack.push(this.undoStack.pop());
        this.clearCanvasSilently();
      }
      return;
    }

    this.isHistoryProcessing = true;
    const currentState = this.undoStack.pop();
    this.redoStack.push(currentState);

    const prevState = this.undoStack[this.undoStack.length - 1];
    this.canvas.loadFromJSON(prevState, () => {
      this.canvas.renderAll();
      this.isHistoryProcessing = false;
    });
  }

  redo() {
    if (this.redoStack.length === 0) return;

    this.isHistoryProcessing = true;
    const nextState = this.redoStack.pop();
    this.undoStack.push(nextState);

    this.canvas.loadFromJSON(nextState, () => {
      this.canvas.renderAll();
      this.isHistoryProcessing = false;
    });
  }

  clearCanvas() {
    this.canvas.clear();
    this.pushHistoryState();
  }

  clearCanvasSilently() {
    this.isHistoryProcessing = true;
    this.canvas.clear();
    this.canvas.renderAll();
    this.isHistoryProcessing = false;
  }
}

// 전역 싱글톤 인스턴스 노출
window.toolManager = new ToolManager();