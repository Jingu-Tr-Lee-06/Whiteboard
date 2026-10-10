/**
 * main.js - 메인 엔트리포인트 및 판서 캔버스 오케스트레이터
 * 태블릿 펜 팜 리젝션, 다중 슬라이드 탭 라이프사이클, 교수자 권한 인증 총괄
 */

class SlideManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.slides = {}; // { [slideId]: { id, title, data, theme } }
    this.activeSlideId = 'slide_1';
    this.slideCounter = 1;
  }

  init() {
    // 1번 기본 슬라이드 등록
    this.slides['slide_1'] = {
      id: 'slide_1',
      title: '칠판 1',
      data: null,
      theme: window.toolManager ? window.toolManager.currentTheme : 'chalkboard'
    };
    this.bindDOM();
    this.renderTabs();
  }

  bindDOM() {
    const btnAdd = document.getElementById('btn-add-slide');
    if (btnAdd) {
      btnAdd.addEventListener('click', () => this.addNewSlide());
    }
  }

  /**
   * 새 칠판 슬라이드 추가
   */
  addNewSlide() {
    if (window.currentUserRole !== 'prof') return;

    this.slideCounter += 1;
    const newId = `slide_${this.slideCounter}`;
    const currentTheme = window.toolManager ? window.toolManager.currentTheme : 'chalkboard';

    // 현재 슬라이드 데이터 저장
    this.saveCurrentSlideState();

    this.slides[newId] = {
      id: newId,
      title: `칠판 ${this.slideCounter}`,
      data: null,
      theme: currentTheme
    };

    this.switchSlide(newId, true);
    this.renderTabs();
  }

  /**
   * 슬라이드 전환
   * @param {string} targetId 
   * @param {boolean} isLocalAction - 로컬 사용자의 탭 클릭 여부
   */
  switchSlide(targetId, isLocalAction = true) {
    if (!this.slides[targetId]) return;

    // 기존 슬라이드 직렬화 저장
    this.saveCurrentSlideState();

    this.activeSlideId = targetId;
    const targetSlide = this.slides[targetId];

    // 캔버스 초기화 후 대상 슬라이드 벡터 패스 로드
    this.canvas.clear();
    if (targetSlide.data && targetSlide.data.objects && targetSlide.data.objects.length > 0) {
      this.canvas.loadFromJSON(targetSlide.data, () => {
        this.canvas.renderAll();
        if (window.toolManager) {
          window.toolManager.pushHistoryState();
        }
      });
    } else {
      this.canvas.renderAll();
      if (window.toolManager) {
        window.toolManager.pushHistoryState();
      }
    }

    // 테마 동기화
    if (window.toolManager && targetSlide.theme) {
      window.toolManager.applyTheme(targetSlide.theme);
    }

    // Firebase 동기화 룸 갱신
    if (window.firebaseSyncManager) {
      window.firebaseSyncManager.setCurrentSlide(targetId);
    }

    this.renderTabs();
  }

  /**
   * 칠판 삭제
   */
  removeSlide(slideId, event) {
    if (event) event.stopPropagation();
    if (window.currentUserRole !== 'prof') return;

    const keys = Object.keys(this.slides);
    if (keys.length <= 1) {
      alert('최소 1개의 칠판은 유지되어야 합니다.');
      return;
    }

    if (!confirm('이 칠판을 삭제하시겠습니까? 판서 내용이 모두 영구 소멸됩니다.')) return;

    delete this.slides[slideId];

    // 삭제된 슬라이드가 현재 보고 있던 슬라이드인 경우 다른 슬라이드로 전환
    if (this.activeSlideId === slideId) {
      const remainingKeys = Object.keys(this.slides);
      this.switchSlide(remainingKeys[0], true);
    } else {
      this.renderTabs();
    }
  }

  /**
   * 현재 활성 슬라이드의 캔버스 상태 직렬화
   */
  saveCurrentSlideState() {
    if (this.slides[this.activeSlideId]) {
      const canvasJson = this.canvas.toJSON();
      const currentTheme = window.toolManager ? window.toolManager.currentTheme : 'chalkboard';
      this.slides[this.activeSlideId].data = canvasJson;
      this.slides[this.activeSlideId].theme = currentTheme;

      if (window.firebaseSyncManager && window.currentUserRole === 'prof') {
        window.firebaseSyncManager.saveSlideData(this.activeSlideId, canvasJson, currentTheme);
      }
    }
  }

  /**
   * 하단 슬라이드 탭 UI 재렌더링
   */
  renderTabs() {
    const track = document.getElementById('slide-tabs-scroll');
    if (!track) return;

    track.innerHTML = '';
    const isProf = window.currentUserRole === 'prof';

    Object.values(this.slides).forEach((slide) => {
      const tabEl = document.createElement('div');
      tabEl.className = `slide-tab-item ${slide.id === this.activeSlideId ? 'active' : ''}`;
      tabEl.setAttribute('data-slide-id', slide.id);

      const labelSpan = document.createElement('span');
      labelSpan.className = 'tab-label';
      labelSpan.textContent = slide.title;
      tabEl.appendChild(labelSpan);

      // 교수자에게만 슬라이드 삭제 닫기(x) 버튼 노출
      if (isProf && Object.keys(this.slides).length > 1) {
        const closeBtn = document.createElement('button');
        closeBtn.className = 'btn-tab-close';
        closeBtn.innerHTML = '&times;';
        closeBtn.title = '칠판 삭제';
        closeBtn.addEventListener('click', (e) => this.removeSlide(slide.id, e));
        tabEl.appendChild(closeBtn);
      }

      tabEl.addEventListener('click', () => {
        if (this.activeSlideId !== slide.id) {
          this.switchSlide(slide.id, true);
        }
      });

      track.appendChild(tabEl);
    });
  }
}

class WhiteboardApp {
  constructor() {
    this.canvas = null;
    this.role = 'student'; // 기본값: 학생 (읽기 전용)
    this.profCode = 'prof1234'; // 기본 인증 코드
  }

  init() {
    window.currentUserRole = this.role;
    this.resolveAuthConfig();
    this.initCanvas();
    this.setupPalmRejection();
    this.setupAuthSystem();
    this.setupPDFExport();
    this.handleResize();
  }

  /**
   * Streamlit 주입 설정에서 교수자 비밀코드 동적 파싱
   */
  resolveAuthConfig() {
    if (window.__AUTH_CONFIG__ && window.__AUTH_CONFIG__.prof_code) {
      this.profCode = window.__AUTH_CONFIG__.prof_code;
    }
  }

  /**
   * Fabric.js 캔버스 인스턴스화
   */
  initCanvas() {
    const canvasEl = document.getElementById('paint-canvas');
    this.canvas = new fabric.Canvas(canvasEl, {
      isDrawingMode: false, // 초기 학생 모드는 드로잉 비활성화
      selection: false,
      renderOnAddRemove: true,
      preserveObjectStacking: true,
      stopContextMenu: true,
      fireRightClick: true
    });

    window.fabricCanvas = this.canvas;

    // 서브시스템 바인딩
    window.toolManager.init(this.canvas);
    window.slideManager = new SlideManager(this.canvas);
    window.slideManager.init();
    window.firebaseSyncManager.init(this.canvas, this.role);

    // 펜으로 완성된 획 Firebase 브로드캐스트 리스너 연결
    this.canvas.on('path:created', (opt) => {
      if (this.role === 'prof' && window.firebaseSyncManager) {
        window.firebaseSyncManager.broadcastStroke(opt.path);
      }
    });

    // 전체 초기화 리스너 연결
    document.getElementById('btn-action-clear').addEventListener('click', () => {
      if (this.role === 'prof' && window.firebaseSyncManager) {
        window.firebaseSyncManager.broadcastClear();
      }
    });
  }

  /**
   * 태블릿 펜 팜 리젝션 (Palm Rejection) 핵심 로직
   * W3C Pointer Events API를 직접 가로채어 손바닥 접촉 차단
   */
  setupPalmRejection() {
    const upperCanvas = this.canvas.upperCanvasEl;
    if (!upperCanvas) return;

    // 포인터 다운 시 펜(pen) 이외의 터치(touch)는 이벤트 전파 완전 차단
    upperCanvas.addEventListener('pointerdown', (e) => {
      if (this.role !== 'prof') {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // 태블릿 펜이 아닌 손바닥/손가락 터치 차단
      if (e.pointerType === 'touch') {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }, { capture: true, passive: false });

    upperCanvas.addEventListener('pointermove', (e) => {
      if (this.role !== 'prof' || e.pointerType === 'touch') {
        e.preventDefault();
        e.stopPropagation();
      }
    }, { capture: true, passive: false });
  }

  /**
   * 교수자 인증 모달 및 권한 전환 로직
   */
  setupAuthSystem() {
    const authModal = document.getElementById('auth-modal');
    const btnOpenAuth = document.getElementById('btn-open-auth-modal');
    const btnCancelAuth = document.getElementById('btn-cancel-auth');
    const btnSubmitAuth = document.getElementById('btn-submit-auth');
    const authInput = document.getElementById('auth-code-input');
    const errorMsg = document.getElementById('auth-error-msg');

    btnOpenAuth.addEventListener('click', () => {
      authModal.classList.add('show');
      authInput.value = '';
      errorMsg.style.display = 'none';
      authInput.focus();
    });

    btnCancelAuth.addEventListener('click', () => {
      authModal.classList.remove('show');
    });

    const submitAuth = () => {
      const enteredCode = authInput.value.trim();
      if (enteredCode === this.profCode) {
        this.grantProfRole();
        authModal.classList.remove('show');
      } else {
        errorMsg.style.display = 'block';
      }
    };

    btnSubmitAuth.addEventListener('click', submitAuth);
    authInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitAuth();
    });
  }

  /**
   * 교수자 권한 승격 실행
   */
  grantProfRole() {
    this.role = 'prof';
    window.currentUserRole = 'prof';

    document.body.classList.remove('user-mode-student');
    document.body.classList.add('user-mode-prof');

    // UI 상태 갱신
    document.getElementById('toolbar').style.display = 'flex';
    document.getElementById('btn-open-auth-modal').style.display = 'none';
    document.getElementById('role-text').textContent = '교수자 모드 (판서 활성)';
    document.getElementById('role-text').style.color = '#30d158';

    // 캔버스 드로잉 모드 해제 및 펜 도구 초기 설정
    this.canvas.isDrawingMode = true;
    window.toolManager.setTool('pen');

    // Firebase 동기화 및 탭 UI 권한 재적용
    if (window.firebaseSyncManager) {
      window.firebaseSyncManager.setRole('prof');
    }
    if (window.slideManager) {
      window.slideManager.renderTabs();
    }
  }

  /**
   * 다중 슬라이드 PDF 내보내기 버튼 이벤트 연결
   */
  setupPDFExport() {
    const exportBtn = document.getElementById('btn-action-export-pdf');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        if (!window.slideManager || !window.pdfExporter) return;
        window.slideManager.saveCurrentSlideState();
        window.pdfExporter.exportSlides(
          window.slideManager.slides,
          window.slideManager.activeSlideId,
          this.canvas,
          '스마트칠판_강의록'
        );
      });
    }
  }

  /**
   * 뷰포트 반응형 리사이징
   */
  handleResize() {
    const resizeCanvas = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      this.canvas.setWidth(width);
      this.canvas.setHeight(height);
      this.canvas.renderAll();
    };

    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('orientationchange', () => {
      setTimeout(resizeCanvas, 200);
    });
    resizeCanvas();
  }
}

// DOM 준비 완료 시 구동
document.addEventListener('DOMContentLoaded', () => {
  window.app = new WhiteboardApp();
  window.app.init();
});