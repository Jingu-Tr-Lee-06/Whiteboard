/**
 * main.js
 * - 애플리케이션 수명 주기 및 UI 이벤트 제어
 * - 학생 모드: 기본 진입 (읽기 전용, 팝업 없이 즉시 캔버스 표시)
 * - 교수자 모드: [교수자 인증] 클릭 시 prompt로 인증 후 툴바 및 탭 삭제(×) 활성화
 * - 하드웨어 팜 리젝션 (pointerType === 'pen' | 'mouse'만 드로잉 허용)
 * - 학생/교수자 공통 PDF 내보내기 지원
 */

class WhiteboardApp {
  constructor() {
    this.canvas = null;
    this.toolManager = null;
    this.slideManager = null;
    this.firebaseSync = null;
    this.currentTheme = 'chalkboard';
    this.isProfessor = false; // 기본값 학생 모드

    this.init();
  }

  init() {
    this.setupFabricCanvas();
    this.setupInputPermissions();
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
      isDrawingMode: false, // 학생 상태에서는 기본적으로 드로잉 비활성화
      selection: false,
      preserveObjectStacking: true,
      fireRightClick: true,
      stopContextMenu: true,
      defaultCursor: 'default'
    });
  }

  setupInputPermissions() {
    const upperCanvas = this.canvas.upperCanvasEl;
    if (!upperCanvas) return;

    upperCanvas.style.touchAction = 'none';

    upperCanvas.addEventListener('pointerdown', (e) => {
      // 1. 학생 권한: 모든 판서 시도 차단
      if (!this.isProfessor) {
        this.canvas.isDrawingMode = false;
        e.stopPropagation();
        return;
      }

      // 2. 교수자 모드: 펜/마우스만 판서 허용, 손날/손가락(touch)은 차단
      if (e.pointerType === 'pen' || e.pointerType === 'mouse') {
        if (this.toolManager.currentTool === 'pen') {
          this.canvas.isDrawingMode = true;
        }
      } else if (e.pointerType === 'touch') {
        this.canvas.isDrawingMode = false;
        e.stopPropagation();
      }
    }, true);

    const restoreDrawingState = (e) => {
      if (this.isProfessor && e.pointerType === 'touch') {
        if (this.toolManager.currentTool === 'pen') {
          this.canvas.isDrawingMode = true;
        }
      }
    };

    upperCanvas.addEventListener('pointerup', restoreDrawingState, true);
    upperCanvas.addEventListener('pointercancel', restoreDrawingState, true);
  }

  handleResize() {
    const container = document.getElementById('canvas-container');
    if (!container || !this.canvas) return;

    this.canvas.setWidth(container.clientWidth);
    this.canvas.setHeight(container.clientHeight);
    this.canvas.renderAll();
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
    // 1. 도구 전환
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

    // 3. 커스텀 색상 선택
    const customPicker = document.getElementById('custom-color-picker');
    if (customPicker) {
      customPicker.addEventListener('input', (e) => {
        if (!this.isProfessor) return;
        document.querySelectorAll('.color-preset-btn').forEach((b) => b.classList.remove('active'));
        this.toolManager.setColor(e.target.value);
      });
    }

    // 4. 지우개 모드
    document.querySelectorAll('.mode-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        if (!this.isProfessor) return;
        document.querySelectorAll('.mode-btn').forEach((b) => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.toolManager.setEraseMode(e.currentTarget.dataset.eraseMode);
      });
    });

    // 5. 두께 조절
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

    // 7. 판서 액션 (실행취소 / 다시실행 / 초기화)
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

    // 8. PDF 다운로드
    document.getElementById('btn-action-export-pdf')?.addEventListener('click', () => this.triggerPdfExport());
    document.getElementById('btn-student-export-pdf')?.addEventListener('click', () => this.triggerPdfExport());

    // 9. 교수자 인증 버튼 (별도 모달창 없이 간결한 prompt 입력으로 처리)
    const btnOpenAuth = document.getElementById('btn-open-auth-modal');
    btnOpenAuth?.addEventListener('click', () => {
      const validCode = window.PROF_AUTH_CODE || 'prof1234';
      const inputCode = prompt('교수자 인증 코드를 입력하세요:');

      if (inputCode === null) return; // 취소 누른 경우

      if (inputCode.trim() === validCode) {
        this.isProfessor = true;
        document.getElementById('toolbar').style.display = 'flex';
        document.getElementById('btn-add-slide').style.display = 'inline-block';
        document.getElementById('role-text').innerText = '교수자 모드 (판서 권한 활성)';
        btnOpenAuth.style.display = 'none';

        // 판서 모드 활성화 및 탭 목록에 닫기(X) 버튼 반영
        this.toolManager.setTool('pen');
        this.setTheme(this.currentTheme);
        this.slideManager.renderTabs();
      } else {
        alert('인증 코드가 일치하지 않습니다.');
      }
    });

    // 10. 슬라이드 추가
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