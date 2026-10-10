/**
 * main.js
 * - 고정 칠판 규격(1920 x 1080) 및 나무 프레임 렌더링
 * - 줌/패닝 연동 반응형 모눈 격자(Grid) 엔진
 * - 기기별 해상도 통일(자동 Center/Fit 정렬)
 * - 팜 리젝션 및 2손가락 핀치 줌/패닝
 */

class WhiteboardApp {
  constructor() {
    this.canvas = null;
    this.toolManager = null;
    this.slideManager = null;
    this.firebaseSync = null;

    // 칠판 고정 크기 (표준 FHD 16:9)
    this.BOARD_WIDTH = 1920;
    this.BOARD_HEIGHT = 1080;
    this.FRAME_THICKNESS = 24; // 나무 테두리 두께

    this.currentTheme = 'chalkboard';
    this.isProfessor = false;

    // 터치 제스처 변수
    this.activeTouches = {};
    this.initialPinchDistance = null;
    this.initialScale = 1;
    this.lastTouchCenter = null;

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
    this.handleResize();

    window.addEventListener('resize', () => this.handleResize());
    window.addEventListener('orientationchange', () => {
      setTimeout(() => this.handleResize(), 200);
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
  }

  /**
   * 칠판 내부 렌더러: 나무 테두리 + 테마 배경 + 스케일 동기화 모눈 격자
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

    // 캔버스 객체들 뒤편(Background)에 직접 렌더링
    this.canvas.on('before:render', () => {
      const ctx = this.canvas.getContext();
      ctx.save();

      const vpt = this.canvas.viewportTransform;
      ctx.transform(vpt[0], vpt[1], vpt[2], vpt[3], vpt[4], vpt[5]);

      const w = this.BOARD_WIDTH;
      const h = this.BOARD_HEIGHT;
      const ft = this.FRAME_THICKNESS;

      // 1. 외곽 나무 테두리 (원목 프레임)
      ctx.fillStyle = '#5c3a21'; // 짙은 원목 베이스
      ctx.fillRect(0, 0, w, h);

      // 나무 음영 입체 효과
      ctx.fillStyle = '#7a4e2d'; // 상단/좌측 하이라이트
      ctx.fillRect(0, 0, w, ft / 3);
      ctx.fillRect(0, 0, ft / 3, h);

      ctx.fillStyle = '#3d2514'; // 하단/우측 그림자
      ctx.fillRect(0, h - ft / 3, w, ft / 3);
      ctx.fillRect(w - ft / 3, 0, ft / 3, h);

      // 2. 내부 칠판 영역 배경
      const boardBg = themeBgColors[this.currentTheme] || themeBgColors.chalkboard;
      ctx.fillStyle = boardBg;
      ctx.fillRect(ft, ft, w - ft * 2, h - ft * 2);

      // 3. 줌 연동 모눈 격자 (내부 칠판 영역에만 클리핑하여 40px 간격으로 렌더링)
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
   * 화면 크기 변화 시 보드를 중앙에 자동 핏(Fit) 정렬
   */
  handleResize(shouldCenter = false) {
    const container = document.getElementById('canvas-container');
    if (!container || !this.canvas) return;

    const winW = container.clientWidth || window.innerWidth;
    const winH = container.clientHeight || window.innerHeight;

    this.canvas.setWidth(winW);
    this.canvas.setHeight(winH);

    // 초기 실행이거나 명시적 센터 정렬 요청 시 화면 중앙 핏
    if (shouldCenter || !this.hasCenteredOnce) {
      const scaleX = (winW * 0.94) / this.BOARD_WIDTH;
      const scaleY = (winH * 0.90) / this.BOARD_HEIGHT;
      const initialScale = Math.min(scaleX, scaleY, 1.2);

      const offsetX = (winW - this.BOARD_WIDTH * initialScale) / 2;
      const offsetY = (winH - this.BOARD_HEIGHT * initialScale) / 2;

      this.canvas.setViewportTransform([initialScale, 0, 0, initialScale, offsetX, offsetY]);
      this.hasCenteredOnce = true;
    }

    this.canvas.requestRenderAll();
  }

  /**
   * 포인터 가드 및 2손가락 핀치 줌 / 패닝
   */
  setupInputAndGestureSecurity() {
    const upperCanvas = this.canvas.upperCanvasEl;
    if (!upperCanvas) return;

    upperCanvas.style.touchAction = 'none';

    // 학생 드로잉 차단 및 팜 리젝션
    upperCanvas.addEventListener('pointerdown', (e) => {
      if (!this.isProfessor) {
        this.canvas.isDrawingMode = false;
        e.stopPropagation();
        return;
      }

      if (e.pointerType === 'pen' || e.pointerType === 'mouse') {
        if (this.toolManager.currentTool === 'pen') {
          this.canvas.isDrawingMode = true;
        }
      } else if (e.pointerType === 'touch') {
        this.canvas.isDrawingMode = false;
      }
    }, true);

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

        // 줌 계산 (0.2배 ~ 5.0배)
        const currentDist = this.calcDistance(touches[0], touches[1]);
        let nextZoom = this.initialScale * (currentDist / this.initialPinchDistance);
        nextZoom = Math.min(Math.max(nextZoom, 0.2), 5.0);

        const currentCenter = {
          x: (touches[0].x + touches[1].x) / 2,
          y: (touches[0].y + touches[1].y) / 2
        };

        const zoomPoint = new fabric.Point(currentCenter.x, currentCenter.y);
        this.canvas.zoomToPoint(zoomPoint, nextZoom);

        // 패닝 (이동)
        if (this.lastTouchCenter) {
          const deltaX = currentCenter.x - this.lastTouchCenter.x;
          const deltaY = currentCenter.y - this.lastTouchCenter.y;
          this.canvas.relativePan(new fabric.Point(deltaX, deltaY));
        }

        this.lastTouchCenter = currentCenter;
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

    // 커스텀 색상
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

    // 두께 슬라이더
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

    // 실행 취소 / 다시 실행 / 초기화
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

    // PDF 내보내기
    document.getElementById('btn-action-export-pdf')?.addEventListener('click', () => this.triggerPdfExport());
    document.getElementById('btn-student-export-pdf')?.addEventListener('click', () => this.triggerPdfExport());

    // 교수자 전환 (prompt)
    document.getElementById('btn-open-auth-modal')?.addEventListener('click', () => {
      const validCode = window.PROF_AUTH_CODE || 'prof1234';
      const inputCode = prompt('교수자 인증 코드를 입력하세요:');

      if (inputCode === null) return;

      if (inputCode.trim() === validCode) {
        this.isProfessor = true;
        document.getElementById('toolbar').style.display = 'flex';
        document.getElementById('btn-add-slide').style.display = 'inline-block';
        document.getElementById('role-text').innerText = '교수자 모드 (판서 권한 활성)';
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