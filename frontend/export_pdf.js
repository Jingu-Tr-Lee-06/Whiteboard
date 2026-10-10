/**
 * export_pdf.js - 완전 재설계 버전
 * - jsPDF 다중 슬라이드 고해상도 PDF 내보내기
 * - 비동기 로딩 완전 대기로 백지(빈 종이) 출력 버그 원천 해결
 * - 칠판 테마 배경색 + 정밀 모눈 격자(Grid) 패턴 일체형 합성
 * - 현재 뷰포트(줌/패닝)와 무관하게 전체 슬라이드 영역 원본 캡처
 */

class PdfExporter {
  constructor() {
    this.themePalette = {
      chalkboard: {
        bg: '#1e3d2f',
        grid: 'rgba(255, 255, 255, 0.08)'
      },
      whiteboard: {
        bg: '#f8fafc',
        grid: 'rgba(0, 0, 0, 0.06)'
      },
      blackboard: {
        bg: '#121212',
        grid: 'rgba(255, 255, 255, 0.09)'
      }
    };
  }

  /**
   * PDF 내보내기 진입점
   * @param {Object} slides 슬라이드 데이터 모음
   * @param {string} currentSlideId 현재 활성화된 슬라이드 ID
   * @param {fabric.Canvas} activeCanvas 현재 메인 화면의 캔버스
   */
  async exportSlides(slides, currentSlideId, activeCanvas) {
    const slideKeys = Object.keys(slides);
    if (!slideKeys.length) {
      alert('저장할 슬라이드가 없습니다.');
      return;
    }

    const originalCursor = document.body.style.cursor;
    document.body.style.cursor = 'wait';

    try {
      // 1. 현재 화면의 최신 판서 데이터 즉시 저장
      if (window.whiteboardApp && window.whiteboardApp.slideManager) {
        window.whiteboardApp.slideManager.saveCurrentSlideData();
      }

      const { jsPDF } = window.jspdf;
      
      // 내보내기 기본 해상도 (표준 고해상도 1920x1080 비율 기준 또는 화면 크기)
      const exportWidth = activeCanvas.width > 0 ? activeCanvas.width : 1920;
      const exportHeight = activeCanvas.height > 0 ? activeCanvas.height : 1080;

      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'px',
        format: [exportWidth, exportHeight]
      });

      // 가상 렌더링용 오프스크린 캔버스 엘리먼트
      const hiddenEl = document.createElement('canvas');
      hiddenEl.width = exportWidth;
      hiddenEl.height = exportHeight;

      const virtualCanvas = new fabric.Canvas(hiddenEl, {
        width: exportWidth,
        height: exportHeight,
        enableRetinaScaling: false
      });

      // 2. 각 슬라이드를 순차적으로 가상 캔버스에 비동기 로드 후 합성
      for (let i = 0; i < slideKeys.length; i++) {
        const key = slideKeys[i];
        const slide = slides[key];
        const theme = slide.theme || 'chalkboard';
        const palette = this.themePalette[theme] || this.themePalette.chalkboard;

        // 슬라이드 벡터 객체들을 가상 캔버스에 완벽히 로드할 때까지 대기
        await this.loadSlideIntoCanvas(virtualCanvas, slide.data);

        // 배경색 + 모눈 격자선 + 판서 획을 2D Context로 직접 병합
        const mergedDataUrl = this.renderMergedImage(virtualCanvas, exportWidth, exportHeight, palette);

        if (i > 0) {
          pdf.addPage([exportWidth, exportHeight], 'landscape');
        }
        pdf.addImage(mergedDataUrl, 'PNG', 0, 0, exportWidth, exportHeight);
      }

      // 메모리 해제
      virtualCanvas.dispose();

      // 3. 파일 저장 실행
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
      const timeStr = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
      pdf.save(`스마트칠판_판서기록_${dateStr}_${timeStr}.pdf`);
    } catch (err) {
      console.error('PDF 생성 오류 발생:', err);
      alert('PDF 파일을 생성하는 중 오류가 발생했습니다.');
    } finally {
      document.body.style.cursor = originalCursor;
    }
  }

  /**
   * JSON 데이터를 패브릭 가상 캔버스에 완전히 로드하는 Promise 함수
   */
  loadSlideIntoCanvas(canvasInstance, slideData) {
    return new Promise((resolve) => {
      canvasInstance.clear();
      canvasInstance.setViewportTransform([1, 0, 0, 1, 0, 0]); // 스케일 1:1 리셋

      if (slideData && slideData.objects && slideData.objects.length > 0) {
        // 내부 채움 속성 제거 (투명 선 보장)
        const sanitizedObjects = slideData.objects.map((obj) => {
          return Object.assign({}, obj, { fill: null });
        });

        const sanitizedData = Object.assign({}, slideData, { objects: sanitizedObjects });

        canvasInstance.loadFromJSON(sanitizedData, () => {
          canvasInstance.renderAll();
          // 브라우저 렌더 루프 보장을 위해 requestAnimationFrame 호출
          requestAnimationFrame(() => {
            resolve();
          });
        });
      } else {
        canvasInstance.renderAll();
        requestAnimationFrame(() => {
          resolve();
        });
      }
    });
  }

  /**
   * 칠판 배경색, 모눈 격자, 판서 레이어를 단일 이미지로 융합
   */
  renderMergedImage(canvasInstance, width, height, palette) {
    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = width;
    outputCanvas.height = height;
    const ctx = outputCanvas.getContext('2d');

    // 1. 단색 배경 채우기
    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, width, height);

    // 2. 미세 모눈 격자(Grid) 패턴 직접 그리기 (40px 간격)
    ctx.strokeStyle = palette.grid;
    ctx.lineWidth = 1;
    const gridSize = 40;

    ctx.beginPath();
    for (let x = 0; x <= width; x += gridSize) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = 0; y <= height; y += gridSize) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();

    // 3. 판서 객체 레이어 그리기
    ctx.drawImage(canvasInstance.lowerCanvasEl, 0, 0, width, height);

    return outputCanvas.toDataURL('image/png');
  }
}

window.pdfExporter = new PdfExporter();