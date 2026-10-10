/**
 * main.js
 * - 고정 칠판 규격(1920 x 1080) 및 원목 테두리 판서 차단(클리핑)
 * - 원화면 복귀 (전체 화면 맞춤)
 * - 교수자 판서 위치 추적 (현재 줌 배율 유지하며 마지막 획으로 이동)
 * - 지우개 원형 커서 줌 배율 실시간 연동
 * - 자유 영역 올가미 이동 및 동기화 지원
 * - 태블릿 2손가락 핀치 줌 & 패닝 및 팜 리젝션
 */

class WhiteboardApp {
  constructor() {
    this.canvas = null;
    this.toolManager = null;
    this.slideManager = null;
    this.firebaseSync = null;

    // 칠판 고정 크기 (표준 FHD 16:9) 및 테두리 두께
    this.BOARD_WIDTH = 1920;
    this.BOARD_HEIGHT = 1080;
    this.FRAME_THICKNESS = 24;

    this.currentTheme = 'chalkboard';
    this.isProfessor = false;

    // 마지막 판서 위치 기록 (교수자 위치 추적용 보드 좌표계)
    this.lastStrokeCenter = {
      x: this.BOARD_WIDTH / 2,
      y: this.BOARD_HEIGHT / 2
    };

    // 터치 제스처 관리 변수
    this.activeTouches = {};
    this.initialPinchDistance = null;
    this.initialScale = 1;
    this.lastTouchCenter = null;
    this.hasCenteredOnce = false;

    this.init();
  }

  init() {
    this.setupFabricCanvas();
    this.setupBoardBackgroundRenderer();
    this.setupInputAndGestureSecurity();

    this.toolManager = new ToolManager(this.canvas);
    this.slideManager = new SlideManager(this.canvas, (theme) => this.setTheme(theme));
    this.firebaseSync = new FirebaseSync(this.canvas, this.slideManager);

    this.bindUIEvents();
    this.handleResize(true);

    window.addEventListener('resize', () => this.handleResize(false));
    window.addEventListener('orientationchange', () => {
      setTimeout(() => this.handleResize(false), 200);
    });
  }

  setupFabricCanvas() {
    const canvasEl = document.getElementById('paint-canvas');
    this.canvas = new fabric.Canvas(canvasEl, {
      isDrawingMode: false,
      selection: false,
      preserveObjectStacking: true,
      fireRightClick: true,
      stopContextMenu: true,
      defaultCursor: 'default'
    });

    // 갈색 테두리 바깥으로 선이 나가지 않도록 내부 칠판 영역 클리핑 마스크 설정
    const ft = this.FRAME_THICKNESS;
    this.canvas.clipPath = new fabric.Rect({
      left: ft,
      top: ft,
      width: this.BOARD_WIDTH - ft * 2,
      height: this.BOARD_HEIGHT - ft * 2,
      absolutePositioned: true
    });
  }

  /**
   * 칠판 내부 렌더러: 나무 테두리 + 배경색 + 스케일 연동 격자
   */
  setupBoardBackgroundRenderer() {
    const themeBgColors = {
      chalkboard: '#1e3d2f',
      whiteboard: '#f8fafc',
      blackboard: '#141414'
    };

    const themeGridColors = {
      chalkboard: 'rgba(255, 255, 255, 0.08)',
      whiteboard: 'rgba(0, 0, 0, 0.07)',
      blackboard: 'rgba(255, 255, 255, 0.09)'
    };

    this.canvas.on('before:render', () => {
      const ctx = this.canvas.getContext();
      ctx.save();

      const vpt = this.canvas.viewportTransform;
      ctx.transform(vpt[0], vpt[1], vpt[2], vpt[3], vpt[4], vpt[5]);

      const w = this.BOARD_WIDTH;
      const h = this.BOARD_HEIGHT;
      const ft = this.FRAME_THICKNESS;

      // 1. 외곽 원목 프레임 테두리
      ctx.fillStyle = '#5c3a21';
      ctx.fillRect(0, 0, w, h);

      ctx.fillStyle = '#7a4e2d';
      ctx.fillRect(0, 0, w, ft / 3);
      ctx.fillRect(0, 0, ft / 3, h);

      ctx.fillStyle = '#3d2514';
      ctx.fillRect(0, h - ft / 3, w, ft / 3);
      ctx.fillRect(w - ft / 3, 0, ft / 3, h);

      // 2. 내부 칠판 영역 배경
      const boardBg = themeBgColors[this.currentTheme] || themeBgColors.chalkboard;
      ctx.fillStyle = boardBg;
      ctx.fillRect(ft, ft, w - ft * 2, h - ft * 2);

      // 3. 모눈 격자
      ctx.save();
      ctx.beginPath();
      ctx.rect(ft, ft, w - ft * 2, h - ft * 2);
      ctx.clip();

      const gridColor = themeGridColors[this.currentTheme] || themeGridColors.chalkboard;
      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 1;
      const gridSize = 40;

      ctx.beginPath();
      for (let x = ft; x <= w - ft; x += gridSize) {
        ctx.moveTo(x, ft);
        ctx.lineTo(x, h - ft);
      }
      for (let y = ft; y <= h - ft; y += gridSize) {
        ctx.moveTo(ft, y);
        ctx.lineTo(w - ft, y);
      }
      ctx.stroke();
      ctx.restore();

      ctx.restore();
    });
  }

  /**
   * 화면 크기에 맞춰 칠판 전체를 화면 중앙에 맞춤 (원화면 복귀)
   */
  fitToScreen() {
    const container = document.getElementById('canvas-container');
    if (!container || !this.canvas) return;

    const winW = container.clientWidth || window.innerWidth;
    const winH = container.clientHeight || window.innerHeight;

    const scaleX = (winW * 0.94) / this.BOARD_WIDTH;
    const scaleY = (winH * 0.90) / this.BOARD_HEIGHT;
    const initialScale = Math.min(scaleX, scaleY, 1.2);

    const offsetX = (winW - this.BOARD_WIDTH * initialScale) / 2;
    const offsetY = (winH - this.BOARD_HEIGHT * initialScale) / 2;

    this.canvas.setViewportTransform([initialScale, 0, 0, initialScale, offsetX, offsetY]);
    if (this.toolManager) {
      this.toolManager.updateEraserCursorSize();
    }
    this.canvas.requestRenderAll();
  }

  handleResize(shouldCenter = false) {
    const container = document.getElementById('canvas-container');
    if (!container || !this.canvas) return;

    const winW = container.clientWidth || window.innerWidth;
    const winH = container.clientHeight || window.innerHeight;

    this.canvas.setWidth(winW);
    this.canvas.setHeight(winH);

    if (shouldCenter || !this.hasCenteredOnce) {
      this.fitToScreen();
      this.hasCenteredOnce = true;
    } else {
      if (this.toolManager) {
        this.toolManager.updateEraserCursorSize();
      }
      this.canvas.requestRenderAll();
    }
  }

  /**
   * 교수자 마지막 판서 위치로 이동 (현재 줌 배율 유지)
   */
  followProfessorPosition() {
    const currentZoom = this.canvas.getZoom();
    const container = document.getElementById('canvas-container');
    const screenWidth = container.clientWidth || window.innerWidth;
    const screenHeight = container.clientHeight || window.innerHeight;

    const targetOffsetX = screenWidth / 2 - this.lastStrokeCenter.x * currentZoom;
    const targetOffsetY = screenHeight / 2 - this.lastStrokeCenter.y * currentZoom;

    this.canvas.setViewportTransform([currentZoom, 0, 0, currentZoom, targetOffsetX, targetOffsetY]);
    if (this.toolManager) {
      this.toolManager.updateEraserCursorSize();
    }
    this.canvas.requestRenderAll();
  }

  /**
   * 테두리 안쪽인지 검사
   */
  isInsideWritableArea(point) {
    const ft = this.FRAME_THICKNESS;
    return (
      point.x >= ft &&
      point.x <= this.BOARD_WIDTH - ft &&
      point.y >= ft &&
      point.y <= this.BOARD_HEIGHT - ft
    );
  }

  /**
   * 입력 보안 및 제스처 핸들링
   */
  setupInputAndGestureSecurity() {
    const upperCanvas = this.canvas.upperCanvasEl;
    if (!upperCanvas) return;

    upperCanvas.style.touchAction = 'none';

    upperCanvas.addEventListener('pointerdown', (e) => {
      if (!this.isProfessor) {
        this.canvas.isDrawingMode = false;
        e.stopPropagation();
        return;
      }

      // 올가미 도구 상태에서는 자유 선택이나 개체 이동을 허용
      if (this.toolManager && this.toolManager.currentTool === 'lasso') {
        this.canvas.isDrawingMode = false;
        return;
      }

      // 지우개 도구인 경우
      if (this.toolManager && this.toolManager.currentTool === 'eraser') {
        this.canvas.isDrawingMode = false;
        return;
      }

      // 펜 도구인 경우 테두리 체크 및 팜 리젝션
      const pointer = this.canvas.getPointer(e);
      if (!this.isInsideWritableArea(pointer)) {
        this.canvas.isDrawingMode = false;
        return;
      }

      if (e.pointerType === 'pen' || e.pointerType === 'mouse') {
        if (this.toolManager && this.toolManager.currentTool === 'pen') {
          this.canvas.isDrawingMode = true;
        }
      } else if (e.pointerType === 'touch') {
        this.canvas.isDrawingMode = false;
      }
    }, true);

    this.canvas.on('path:created', (e) => {
      if (e.path) {
        const center = e.path.getCenterPoint();
        this.lastStrokeCenter = { x: center.x, y: center.y };
      }
    });

    // 2손가락 터치 제스처
    upperCanvas.addEventListener('touchstart', (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        this.activeTouches[t.identifier] = { x: t.clientX, y: t.clientY };
      }

      const touches = Object.values(this.activeTouches);
      if (touches.length === 2) {
        this.canvas.isDrawingMode = false;
        this.initialPinchDistance = this.calcDistance(touches[0], touches[1]);
        this.initialScale = this.canvas.getZoom();
        this.lastTouchCenter = {
          x: (touches[0].x + touches[1].x) / 2,
          y: (touches[0].y + touches[1].y) / 2
        };
      }
    }, { passive: false });

    upperCanvas.addEventListener('touchmove', (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (this.activeTouches[t.identifier]) {
          this.activeTouches[t.identifier] = { x: t.clientX, y: t.clientY };
        }
      }

      const touches = Object.values(this.activeTouches);
      if (touches.length === 2 && this.initialPinchDistance) {
        e.preventDefault();

        const currentDist = this.calcDistance(touches[0], touches[1]);
        let nextZoom = this.initialScale * (currentDist / this.initialPinchDistance);
        nextZoom = Math.min(Math.max(nextZoom, 0.2), 5.0);

        const currentCenter = {
          x: (touches[0].x + touches[1].x) / 2,
          y: (touches[0].y + touches[1].y) / 2
        };

        const zoomPoint = new fabric.Point(currentCenter.x, currentCenter.y);
        this.canvas.zoomToPoint(zoomPoint, nextZoom);

        if (this.lastTouchCenter) {
          const deltaX = currentCenter.x - this.lastTouchCenter.x;
          const deltaY = currentCenter.y - this.lastTouchCenter.y;
          this.canvas.relativePan(new fabric.Point(deltaX, deltaY));
        }

        this.lastTouchCenter = currentCenter;

        if (this.toolManager) {
          this.toolManager.updateEraserCursorSize();
        }

        this.canvas.requestRenderAll();
      }
    }, { passive: false });

    const finishTouch = (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        delete this.activeTouches[e.changedTouches[i].identifier];
      }

      const touches = Object.values(this.activeTouches);
      if (touches.length < 2) {
        this.initialPinchDistance = null;
        this.lastTouchCenter = null;
        if (this.isProfessor && this.toolManager.currentTool === 'pen') {
          this.canvas.isDrawingMode = true;
        }
      }
    };

    upperCanvas.addEventListener('touchend', finishTouch);
    upperCanvas.addEventListener('touchcancel', finishTouch);

    // PC 휠 줌
    this.canvas.on('mouse:wheel', (opt) => {
      const delta = opt.e.deltaY;
      let zoom = this.canvas.getZoom();
      zoom *= 0.999 ** delta;
      zoom = Math.min(Math.max(zoom, 0.2), 5.0);
      this.canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
      
      if (this.toolManager) {
        this.toolManager.updateEraserCursorSize();
      }

      opt.e.preventDefault();
      opt.e.stopPropagation();
    });
  }

  calcDistance(p1, p2) {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  setTheme(themeName) {
    this.currentTheme = themeName;
    document.body.className = `theme-${themeName} ${this.isProfessor ? 'user-mode-professor' : 'user-mode-student'}`;

    if (themeName === 'whiteboard') {
      if (this.toolManager.currentColor === '#FFFFFF') {
        this.toolManager.setColor('#1E88E5');
      }
    } else {
      if (this.toolManager.currentColor === '#1E88E5') {
        this.toolManager.setColor('#FFFFFF');
      }
    }

    this.canvas.requestRenderAll();
  }

  triggerPdfExport() {
    if (window.pdfExporter) {
      window.pdfExporter.exportSlides(
        this.slideManager.slides,
        this.BOARD_WIDTH,
        this.BOARD_HEIGHT,
        this.FRAME_THICKNESS
      );
    }
  }

  bindUIEvents() {
    document.getElementById('btn-fit-screen')?.addEventListener('click', () => {
      this.fitToScreen();
    });

    document.getElementById('btn-follow-prof')?.addEventListener('click', () => {
      this.followProfessorPosition();
    });

    // 도구 전환
    document.querySelectorAll('.tool-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        if (!this.isProfessor) return;
        document.querySelectorAll('.tool-btn').forEach((b) => b.classList.remove('active'));
        const targetBtn = e.currentTarget;
        targetBtn.classList.add('active');

        const tool = targetBtn.dataset.tool;
        this.toolManager.setTool(tool);

        document.getElementById('pen-settings').style.display = tool === 'pen' ? 'flex' : 'none';
        document.getElementById('eraser-settings').style.display = tool === 'eraser' ? 'flex' : 'none';
      });
    });

    // 프리셋 색상
    document.querySelectorAll('.color-preset-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        if (!this.isProfessor) return;
        document.querySelectorAll('.color-preset-btn').forEach((b) => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.toolManager.setColor(e.currentTarget.dataset.color);
      });
    });

    // 커스텀 색상 피커
    document.getElementById('custom-color-picker')?.addEventListener('input', (e) => {
      if (!this.isProfessor) return;
      document.querySelectorAll('.color-preset-btn').forEach((b) => b.classList.remove('active'));
      this.toolManager.setColor(e.target.value);
    });

    // 지우개 모드
    document.querySelectorAll('.mode-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        if (!this.isProfessor) return;
        document.querySelectorAll('.mode-btn').forEach((b) => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.toolManager.setEraseMode(e.currentTarget.dataset.eraseMode);
      });
    });

    // 크기/두께 슬라이더
    document.getElementById('size-slider')?.addEventListener('input', (e) => {
      if (!this.isProfessor) return;
      const val = e.target.value;
      const display = document.getElementById('size-display-val');
      if (display) display.innerText = `${val}px`;
      this.toolManager.setSize(val);
    });

    // 테마 선택
    document.getElementById('select-board-theme')?.addEventListener('change', (e) => {
      if (!this.isProfessor) return;
      const theme = e.target.value;
      this.setTheme(theme);
      this.slideManager.updateCurrentSlideTheme(theme);
      if (this.firebaseSync) {
        this.firebaseSync.broadcastCurrentTheme(theme);
      }
    });

    // Undo / Redo / Clear
    document.getElementById('btn-action-undo')?.addEventListener('click', () => {
      if (this.isProfessor) this.slideManager.undo();
    });

    document.getElementById('btn-action-redo')?.addEventListener('click', () => {
      if (this.isProfessor) this.slideManager.redo();
    });

    document.getElementById('btn-action-clear')?.addEventListener('click', () => {
      if (!this.isProfessor) return;
      if (confirm('현재 칠판 판서를 모두 지우시겠습니까?')) {
        this.canvas.clear();
        this.canvas.requestRenderAll();
        if (this.firebaseSync) {
          this.firebaseSync.broadcastClear();
        }
      }
    });

    // PDF 다운로드
    document.getElementById('btn-action-export-pdf')?.addEventListener('click', () => this.triggerPdfExport());
    document.getElementById('btn-student-export-pdf')?.addEventListener('click', () => this.triggerPdfExport());

    // 교수자 인증 전환
    document.getElementById('btn-open-auth-modal')?.addEventListener('click', () => {
      const validCode = window.PROF_AUTH_CODE || 'prof1234';
      const inputCode = prompt('교수자 인증 코드를 입력하세요:');

      if (inputCode === null) return;

      if (inputCode.trim() === validCode) {
        this.isProfessor = true;
        document.getElementById('toolbar').style.display = 'flex';
        document.getElementById('btn-add-slide').style.display = 'inline-block';
        document.getElementById('role-text').innerText = '교수자 모드';
        document.getElementById('btn-open-auth-modal').style.display = 'none';

        this.toolManager.setTool('pen');
        this.setTheme(this.currentTheme);
        this.slideManager.renderTabs();
      } else {
        alert('인증 코드가 일치하지 않습니다.');
      }
    });

    // 슬라이드 추가
    document.getElementById('btn-add-slide')?.addEventListener('click', () => {
      if (this.isProfessor) {
        this.slideManager.addNewSlide();
      }
    });
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.whiteboardApp = new WhiteboardApp();
});