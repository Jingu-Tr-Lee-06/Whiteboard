/**
 * main.js - 완전 재설계 버전
 * - 학생 모드: 판서 원천 차단 (포인터 캡처 및 드로잉 이벤트 차단)
 * - 교수자 모드: 펜/마우스만 판서 허용, 손날/터치 간섭 차단 (팜 리젝션)
 * - 태블릿 2손가락 핀치 줌(확대/축소) 및 패닝(이동) 제스처 지원
 * - prompt 기반 간결한 교수자 인증 및 탭 UI 즉시 갱신
 */

class WhiteboardApp {
  constructor() {
    this.canvas = null;
    this.toolManager = null;
    this.slideManager = null;
    this.firebaseSync = null;
    this.currentTheme = 'chalkboard';
    this.isProfessor = false; // 기본값 학생 모드

    // 2손가락 터치 제스처 관리 변수
    this.activeTouches = {};
    this.initialPinchDistance = null;
    this.initialScale = 1;
    this.lastTouchCenter = null;

    this.init();
  }

  init() {
    this.setupFabricCanvas();
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
      isDrawingMode: false, // 초기 진입 시 학생 상태이므로 드로잉 비활성화
      selection: false,
      preserveObjectStacking: true,
      fireRightClick: true,
      stopContextMenu: true,
      defaultCursor: 'default'
    });
  }

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
   * 보안 입력 제어: 학생 권한 차단 + 태블릿 팜 리젝션 + 2손가락 줌/패닝
   */
  setupInputAndGestureSecurity() {
    const upperCanvas = this.canvas.upperCanvasEl;
    if (!upperCanvas) return;

    upperCanvas.style.touchAction = 'none';

    // 1. 포인터 다운: 학생 모드 완전 차단 및 팜 리젝션
    upperCanvas.addEventListener('pointerdown', (e) => {
      // 학생 모드일 때는 모든 드로잉 시도를 차단
      if (!this.isProfessor) {
        this.canvas.isDrawingMode = false;
        e.stopPropagation();
        return;
      }

      // 교수자일 때: 펜 또는 마우스 입력만 판서 허용
      if (e.pointerType === 'pen' || e.pointerType === 'mouse') {
        if (this.toolManager.currentTool === 'pen') {
          this.canvas.isDrawingMode = true;
        }
      } else if (e.pointerType === 'touch') {
        // 손가락/손날은 필기 차단 (팜 리젝션 및 제스처 대기)
        this.canvas.isDrawingMode = false;
      }
    }, true);

    // 2. 멀티터치 제스처 (2손가락 핀치 줌 & 패닝)
    upperCanvas.addEventListener('touchstart', (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        this.activeTouches[t.identifier] = { x: t.clientX, y: t.clientY };
      }

      const touches = Object.values(this.activeTouches);
      if (touches.length === 2) {
        this.canvas.isDrawingMode = false; // 제스처 중 필기 방지
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

        // 핀치 줌 (0.5배 ~ 4.0배 범위 제한)
        const currentDist = this.calcDistance(touches[0], touches[1]);
        let nextZoom = this.initialScale * (currentDist / this.initialPinchDistance);
        nextZoom = Math.min(Math.max(nextZoom, 0.5), 4.0);

        const currentCenter = {
          x: (touches[0].x + touches[1].x) / 2,
          y: (touches[0].y + touches[1].y) / 2
        };

        const zoomPoint = new fabric.Point(currentCenter.x, currentCenter.y);
        this.canvas.zoomToPoint(zoomPoint, nextZoom);

        // 2손가락 동시 드래그 시 패닝(이동)
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

    // PC 마우스 휠 줌
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
    // 1. 도구 버튼 선택
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

    // 2. 색상 프리셋
    document.querySelectorAll('.color-preset-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        if (!this.isProfessor) return;
        document.querySelectorAll('.color-preset-btn').forEach((b) => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.toolManager.setColor(e.currentTarget.dataset.color);
      });
    });

    // 3. 커스텀 색상 피커
    const customPicker = document.getElementById('custom-color-picker');
    if (customPicker) {
      customPicker.addEventListener('input', (e) => {
        if (!this.isProfessor) return;
        document.querySelectorAll('.color-preset-btn').forEach((b) => b.classList.remove('active'));
        this.toolManager.setColor(e.target.value);
      });
    }

    // 4. 지우개 모드 (획/영역)
    document.querySelectorAll('.mode-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        if (!this.isProfessor) return;
        document.querySelectorAll('.mode-btn').forEach((b) => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.toolManager.setEraseMode(e.currentTarget.dataset.eraseMode);
      });
    });

    // 5. 브러시 두께 슬라이더
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

    // 6. 테마 드롭다운
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

    // 7. 실행 취소 / 다시 실행 / 초기화
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

    // 8. PDF 다운로드 (교수자 및 학생 공통 지원)
    document.getElementById('btn-action-export-pdf')?.addEventListener('click', () => this.triggerPdfExport());
    document.getElementById('btn-student-export-pdf')?.addEventListener('click', () => this.triggerPdfExport());

    // 9. 교수자 전환 (초기 화면 가림 없는 prompt 인증)
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

        // 펜 도구 활성화 및 탭 목록에 닫기(X) 버튼 즉시 렌더링
        this.toolManager.setTool('pen');
        this.setTheme(this.currentTheme);
        this.slideManager.renderTabs();
      } else {
        alert('인증 코드가 일치하지 않습니다.');
      }
    });

    // 10. 슬라이드 추가 (+ 칠판 추가)
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