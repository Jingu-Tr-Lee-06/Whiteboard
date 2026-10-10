/**
 * main.js
 * - 애플리케이션 수명 주기 및 UI 제어
 * - 태블릿 2손가락 핀치 줌(확대/축소) & 패닝(이동) 제스처 지원
 * - 펜/마우스 필기 분리 및 팜 리젝션
 * - 동적 뷰포트(100dvh) 리사이즈 대응
 */

class WhiteboardApp {
  constructor() {
    this.canvas = null;
    this.toolManager = null;
    this.slideManager = null;
    this.firebaseSync = null;
    this.currentTheme = 'chalkboard';
    this.isProfessor = false;

    // 터치 제스처 (핀치 줌 & 패닝) 상태 변수
    this.activeTouches = {};
    this.initialPinchDistance = null;
    this.initialScale = 1;
    this.lastTouchCenter = null;

    this.init();
  }

  init() {
    this.setupFabricCanvas();
    this.setupGestureAndInputHandling();
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
   * 동적 뷰포트 크기 반영
   */
  handleResize() {
    const container = document.getElementById('canvas-container');
    if (!container || !this.canvas) return;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    this.canvas.setWidth(width);
    this.canvas.setHeight(height);
    this.canvas.requestRenderAll();
  }

  /**
   * 입력 이벤트 분기: 팜 리젝션 및 2손가락 핀치 줌/패닝
   */
  setupGestureAndInputHandling() {
    const upperCanvas = this.canvas.upperCanvasEl;
    if (!upperCanvas) return;

    upperCanvas.style.touchAction = 'none';

    // 1. 하드웨어 포인터 필터링 (펜/마우스 vs 터치)
    upperCanvas.addEventListener('pointerdown', (e) => {
      if (!this.isProfessor) {
        this.canvas.isDrawingMode = false;
        return;
      }

      // 펜 또는 마우스일 때만 필기 활성화
      if (e.pointerType === 'pen' || e.pointerType === 'mouse') {
        if (this.toolManager.currentTool === 'pen') {
          this.canvas.isDrawingMode = true;
        }
      } else if (e.pointerType === 'touch') {
        // 손가락 터치는 필기 차단 (팜 리젝션)
        this.canvas.isDrawingMode = false;
      }
    }, true);

    // 2. 터치 제스처 처리 (2손가락 핀치 줌 & 패닝)
    upperCanvas.addEventListener('touchstart', (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        this.activeTouches[touch.identifier] = { x: touch.clientX, y: touch.clientY };
      }

      const touches = Object.values(this.activeTouches);
      if (touches.length === 2) {
        // 드로잉 즉시 중단
        this.canvas.isDrawingMode = false;
        this.initialPinchDistance = this.getDistance(touches[0], touches[1]);
        this.initialScale = this.canvas.getZoom();
        this.lastTouchCenter = {
          x: (touches[0].x + touches[1].x) / 2,
          y: (touches[0].y + touches[1].y) / 2
        };
      }
    }, { passive: false });

    upperCanvas.addEventListener('touchmove', (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (this.activeTouches[touch.identifier]) {
          this.activeTouches[touch.identifier] = { x: touch.clientX, y: touch.clientY };
        }
      }

      const touches = Object.values(this.activeTouches);
      if (touches.length === 2 && this.initialPinchDistance) {
        e.preventDefault(); // 스크롤 등 기본 동작 방지

        // 확대/축소 (줌)
        const currentDist = this.getDistance(touches[0], touches[1]);
        let newZoom = this.initialScale * (currentDist / this.initialPinchDistance);
        newZoom = Math.min(Math.max(newZoom, 0.5), 4.0); // 0.5배 ~ 4배 제한

        const currentCenter = {
          x: (touches[0].x + touches[1].x) / 2,
          y: (touches[0].y + touches[1].y) / 2
        };

        const zoomPoint = new fabric.Point(currentCenter.x, currentCenter.y);
        this.canvas.zoomToPoint(zoomPoint, newZoom);

        // 이동 (패닝)
        if (this.lastTouchCenter) {
          const deltaX = currentCenter.x - this.lastTouchCenter.x;
          const deltaY = currentCenter.y - this.lastTouchCenter.y;
          this.canvas.relativePan(new fabric.Point(deltaX, deltaY));
        }

        this.lastTouchCenter = currentCenter;
        this.canvas.requestRenderAll();
      }
    }, { passive: false });

    const handleTouchEnd = (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        delete this.activeTouches[e.changedTouches[i].identifier];
      }

      const touches = Object.values(this.activeTouches);
      if (touches.length < 2) {
        this.initialPinchDistance = null;
        this.lastTouchCenter = null;
        // 교수자 상태라면 펜 쓰기 모드 복구
        if (this.isProfessor && this.toolManager.currentTool === 'pen') {
          this.canvas.isDrawingMode = true;
        }
      }
    };

    upperCanvas.addEventListener('touchend', handleTouchEnd);
    upperCanvas.addEventListener('touchcancel', handleTouchEnd);

    // PC 마우스 휠 줌 지원
    this.canvas.on('mouse:wheel', (opt) => {
      const delta = opt.e.deltaY;
      let zoom = this.canvas.getZoom();
      zoom *= 0.999 ** delta;
      zoom = Math.min(Math.max(zoom, 0.5), 4.0);
      this.canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
      opt.e.preventDefault();
      opt.e.stopPropagation();
    });
  }

  getDistance(p1, p2) {
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
  }

  triggerPdfExport() {
    if (window.pdfExporter) {
      window.pdfExporter.exportSlides(
        this.slideManager.slides,
        this.slideManager.currentSlideId,
        this.canvas
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

    // 커스텀 색상 피커
    const customPicker = document.getElementById('custom-color-picker');
    if (customPicker) {
      customPicker.addEventListener('input', (e) => {
        if (!this.isProfessor) return;
        document.querySelectorAll('.color-preset-btn').forEach((b) => b.classList.remove('active'));
        this.toolManager.setColor(e.target.value);
      });
    }

    // 지우개 모드
    document.querySelectorAll('.mode-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        if (!this.isProfessor) return;
        document.querySelectorAll('.mode-btn').forEach((b) => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.toolManager.setEraseMode(e.currentTarget.dataset.eraseMode);
      });
    });

    // 두께 조절
    const sizeSlider = document.getElementById('size-slider');
    const sizeDisplay = document.getElementById('size-display-val');
    if (sizeSlider) {
      sizeSlider.addEventListener('input', (e) => {
        if (!this.isProfessor) return;
        const val = e.target.value;
        if (sizeDisplay) sizeDisplay.innerText = `${val}px`;
        this.toolManager.setSize(val);
      });
    }

    // 테마 드롭다운
    const themeSelect = document.getElementById('select-board-theme');
    if (themeSelect) {
      themeSelect.addEventListener('change', (e) => {
        if (!this.isProfessor) return;
        const theme = e.target.value;
        this.setTheme(theme);
        this.slideManager.updateCurrentSlideTheme(theme);
        if (this.firebaseSync) {
          this.firebaseSync.broadcastCurrentTheme(theme);
        }
      });
    }

    // 판서 액션 (실행취소 / 다시실행 / 초기화)
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

    // 교수자 인증 (prompt 방식)
    const btnOpenAuth = document.getElementById('btn-open-auth-modal');
    btnOpenAuth?.addEventListener('click', () => {
      const validCode = window.PROF_AUTH_CODE || 'prof1234';
      const inputCode = prompt('교수자 인증 코드를 입력하세요:');

      if (inputCode === null) return;

      if (inputCode.trim() === validCode) {
        this.isProfessor = true;
        document.getElementById('toolbar').style.display = 'flex';
        document.getElementById('btn-add-slide').style.display = 'inline-block';
        document.getElementById('role-text').innerText = '교수자 모드 (판서 권한 활성)';
        btnOpenAuth.style.display = 'none';

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