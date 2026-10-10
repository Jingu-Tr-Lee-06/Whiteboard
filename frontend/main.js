/**
 * main.js - 팜 리젝션(손날 터치 직선 차단) 및 캔버스 초기화 관리
 */

class WhiteboardApp {
  constructor() {
    this.canvas = null;
    this.toolManager = null;
    this.slideManager = null;
    this.firebaseSync = null;
    this.currentTheme = 'chalkboard';
    this.isProfessor = false;

    this.init();
  }

  init() {
    this.setupFabricCanvas();
    this.setupPalmRejection();
    this.toolManager = new ToolManager(this.canvas);
    this.slideManager = new SlideManager(this.canvas, (theme) => this.setTheme(theme));
    this.firebaseSync = new FirebaseSync(this.canvas, this.slideManager);

    this.bindUIEvents();
    this.handleResize();
    window.addEventListener('resize', () => this.handleResize());
  }

  setupFabricCanvas() {
    const canvasEl = document.getElementById('paint-canvas');
    this.canvas = new fabric.Canvas(canvasEl, {
      isDrawingMode: true,
      selection: false,
      preserveObjectStacking: true,
      fireRightClick: true,
      stopContextMenu: true
    });
  }

  /**
   * 팜 리젝션 핵심 로직:
   * 펜(pen)이나 마우스(mouse) 입력만 통과시키고, 손가락/손바닥(touch)은 획 그리기를 완전 차단
   */
  setupPalmRejection() {
    const upperCanvas = this.canvas.upperCanvasEl;
    if (!upperCanvas) return;

    // 브라우저 기본 제스처(핀치줌, 스크롤 등) 캔버스 영역 차단
    upperCanvas.style.touchAction = 'none';

    // 포인터 다운 시점 필터링
    upperCanvas.addEventListener('pointerdown', (e) => {
      // 1. 스타일러스 펜이거나 데스크톱 마우스인 경우 정상 입력 허용
      if (e.pointerType === 'pen' || e.pointerType === 'mouse') {
        if (this.isProfessor && this.toolManager.currentTool === 'pen') {
          this.canvas.isDrawingMode = true;
        }
        return;
      }

      // 2. 손가락 및 손날(touch)인 경우 드로잉 일시 차단 (선 튀는 현상 원천 방지)
      if (e.pointerType === 'touch') {
        this.canvas.isDrawingMode = false;
        // 터치 제스처로 인한 오작동 전파 중단
        e.stopPropagation();
      }
    }, true);

    // 포인터가 떨어지거나 벗어났을 때 원래 툴 모드로 원복
    const restoreDrawing = (e) => {
      if (e.pointerType === 'touch' && this.isProfessor) {
        if (this.toolManager.currentTool === 'pen') {
          this.canvas.isDrawingMode = true;
        }
      }
    };

    upperCanvas.addEventListener('pointerup', restoreDrawing, true);
    upperCanvas.addEventListener('pointercancel', restoreDrawing, true);
  }

  handleResize() {
    const container = document.getElementById('canvas-container');
    if (!container || !this.canvas) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    this.canvas.setWidth(width);
    this.canvas.setHeight(height);
    this.canvas.renderAll();
  }

  setTheme(themeName) {
    this.currentTheme = themeName;
    document.body.className = `theme-${themeName} ${this.isProfessor ? 'user-mode-professor' : 'user-mode-student'}`;

    // 칠판 기본 분필 색상 자동 맞춤
    if (themeName === 'whiteboard') {
      if (this.toolManager.currentColor === '#FFFFFF') {
        this.toolManager.setColor('#1E88E5'); // 파란 펜으로 자동 전환
      }
    } else {
      if (this.toolManager.currentColor === '#1E88E5') {
        this.toolManager.setColor('#FFFFFF'); // 흰색 분필로 원복
      }
    }
  }

  bindUIEvents() {
    // 1. 도구 선택 (펜 / 지우개 / 올가미)
    document.querySelectorAll('.tool-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.tool-btn').forEach((b) => b.classList.remove('active'));
        const targetBtn = e.currentTarget;
        targetBtn.classList.add('active');

        const tool = targetBtn.dataset.tool;
        this.toolManager.setTool(tool);

        // 옵션 바 표시 제어
        document.getElementById('pen-settings').style.display = tool === 'pen' ? 'flex' : 'none';
        document.getElementById('eraser-settings').style.display = tool === 'eraser' ? 'flex' : 'none';
      });
    });

    // 2. 색상 프리셋
    document.querySelectorAll('.color-preset-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.color-preset-btn').forEach((b) => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.toolManager.setColor(e.currentTarget.dataset.color);
      });
    });

    // 커스텀 색상 피커
    const customPicker = document.getElementById('custom-color-picker');
    if (customPicker) {
      customPicker.addEventListener('input', (e) => {
        document.querySelectorAll('.color-preset-btn').forEach((b) => b.classList.remove('active'));
        this.toolManager.setColor(e.target.value);
      });
    }

    // 3. 지우개 모드 토글 (획 지우기 / 영역 지우기)
    document.querySelectorAll('.mode-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.mode-btn').forEach((b) => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.toolManager.setEraseMode(e.currentTarget.dataset.eraseMode);
      });
    });

    // 4. 두께 슬라이더
    const sizeSlider = document.getElementById('size-slider');
    const sizeDisplay = document.getElementById('size-display-val');
    if (sizeSlider) {
      sizeSlider.addEventListener('input', (e) => {
        const val = e.target.value;
        if (sizeDisplay) sizeDisplay.innerText = `${val}px`;
        this.toolManager.setSize(val);
      });
    }

    // 5. 테마 변경
    const themeSelect = document.getElementById('select-board-theme');
    if (themeSelect) {
      themeSelect.addEventListener('change', (e) => {
        const theme = e.target.value;
        this.setTheme(theme);
        this.slideManager.updateCurrentSlideTheme(theme);
        if (this.firebaseSync) {
          this.firebaseSync.broadcastCurrentTheme(theme);
        }
      });
    }

    // 6. 실행 취소 / 다시 실행 / 초기화
    document.getElementById('btn-action-undo')?.addEventListener('click', () => {
      this.slideManager.undo();
    });

    document.getElementById('btn-action-redo')?.addEventListener('click', () => {
      this.slideManager.redo();
    });

    document.getElementById('btn-action-clear')?.addEventListener('click', () => {
      if (confirm('현재 칠판 판서를 모두 지우시겠습니까?')) {
        this.canvas.clear();
        this.canvas.requestRenderAll();
        if (this.firebaseSync) {
          this.firebaseSync.broadcastClear();
        }
      }
    });

    // 7. PDF 내보내기
    document.getElementById('btn-action-export-pdf')?.addEventListener('click', () => {
      if (window.pdfExporter) {
        window.pdfExporter.exportSlides(
          this.slideManager.slides,
          this.slideManager.currentSlideId,
          this.canvas
        );
      }
    });

    // 8. 교수자 인증 모달 제어
    const authModal = document.getElementById('auth-modal');
    const btnOpenAuth = document.getElementById('btn-open-auth-modal');
    const btnCancelAuth = document.getElementById('btn-cancel-auth');
    const btnSubmitAuth = document.getElementById('btn-submit-auth');
    const authInput = document.getElementById('auth-code-input');
    const authError = document.getElementById('auth-error-msg');

    btnOpenAuth?.addEventListener('click', () => {
      authModal.style.display = 'flex';
      authInput.value = '';
      authError.style.display = 'none';
      authInput.focus();
    });

    btnCancelAuth?.addEventListener('click', () => {
      authModal.style.display = 'none';
    });

    btnSubmitAuth?.addEventListener('click', () => {
      const inputCode = authInput.value.trim();
      // Streamlit secrets에 설정된 prof_code (기본: prof1234)
      const validCode = window.PROF_AUTH_CODE || 'prof1234';

      if (inputCode === validCode) {
        this.isProfessor = true;
        authModal.style.display = 'none';
        document.getElementById('toolbar').style.display = 'flex';
        document.getElementById('role-text').innerText = '교수자 모드 (판서 권한 활성)';
        btnOpenAuth.style.display = 'none';
        this.setTheme(this.currentTheme);
      } else {
        authError.style.display = 'block';
      }
    });

    // 9. 슬라이드 추가 버튼
    document.getElementById('btn-add-slide')?.addEventListener('click', () => {
      if (!this.isProfessor) {
        alert('칠판 추가는 교수자만 가능합니다.');
        return;
      }
      this.slideManager.addNewSlide();
    });
  }
}

// 애플리케이션 기동
window.addEventListener('DOMContentLoaded', () => {
  window.whiteboardApp = new WhiteboardApp();
});