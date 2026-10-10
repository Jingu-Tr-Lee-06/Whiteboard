/**
 * export_pdf.js
 * - 생성된 모든 슬라이드를 백그라운드 가상 캔버스로 순회 렌더링
 * - 테마 배경색(초록/화이트/블랙) 유지 및 고화질 이미지 추출
 * - jsPDF를 통한 다중 페이지 PDF 로컬 다운로드
 */

class PdfExporter {
  constructor() {
    this.themeColors = {
      chalkboard: '#1e3d2f',
      whiteboard: '#ffffff',
      blackboard: '#121212'
    };
  }

  /**
   * 전체 슬라이드 PDF 내보내기 진입 함수
   * @param {Object} slides 슬라이드 데이터 객체 모음
   * @param {string} currentSlideId 현재 활성화된 슬라이드 ID
   * @param {fabric.Canvas} activeCanvas 현재 활성 Fabric 캔버스
   */
  async exportSlides(slides, currentSlideId, activeCanvas) {
    const slideKeys = Object.keys(slides);
    if (!slideKeys.length) {
      alert('저장할 슬라이드가 없습니다.');
      return;
    }

    // 다운로드 버튼 비활성화 및 처리 중 안내
    const originalCursor = document.body.style.cursor;
    document.body.style.cursor = 'wait';

    try {
      const { jsPDF } = window.jspdf;
      
      // 캔버스 크기 기준 비율 계산 (A4 가로 방향 기준)
      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'px',
        format: [activeCanvas.width, activeCanvas.height]
      });

      // 백그라운드 가상 캔버스 엘리먼트 생성
      const tempCanvasEl = document.createElement('canvas');
      tempCanvasEl.width = activeCanvas.width;
      tempCanvasEl.height = activeCanvas.height;
      const tempCanvas = new fabric.Canvas(tempCanvasEl, {
        width: activeCanvas.width,
        height: activeCanvas.height,
        enableRetinaScaling: false
      });

      for (let i = 0; i < slideKeys.length; i++) {
        const key = slideKeys[i];
        const slide = slides[key];
        const bgColor = this.themeColors[slide.theme] || '#1e3d2f';

        // 1. 현재 화면에 열려 있는 활성 슬라이드인 경우 직접 캡처
        if (key === currentSlideId) {
          const imgData = this.captureCanvasWithBackground(activeCanvas, bgColor);
          if (i > 0) pdf.addPage([activeCanvas.width, activeCanvas.height], 'landscape');
          pdf.addImage(imgData, 'PNG', 0, 0, activeCanvas.width, activeCanvas.height);
        } else {
          // 2. 다른 슬라이드는 가상 캔버스에 로드 후 캡처
          await this.renderSlideToCanvas(tempCanvas, slide, bgColor);
          const imgData = this.captureCanvasWithBackground(tempCanvas, bgColor);
          if (i > 0) pdf.addPage([activeCanvas.width, activeCanvas.height], 'landscape');
          pdf.addImage(imgData, 'PNG', 0, 0, activeCanvas.width, activeCanvas.height);
        }
      }

      // 가상 캔버스 메모리 해제
      tempCanvas.dispose();

      // 파일명 생성 및 다운로드 (예: 판서기록_20261010_1518.pdf)
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
      const timeStr = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
      pdf.save(`판서기록_${dateStr}_${timeStr}.pdf`);
    } catch (err) {
      console.error('PDF 생성 중 오류 발생:', err);
      alert('PDF 생성에 실패했습니다. 다시 시도해 주세요.');
    } finally {
      document.body.style.cursor = originalCursor;
    }
  }

  /**
   * 지정된 슬라이드 JSON 데이터를 대상 캔버스에 렌더링하는 비동기 함수
   */
  renderSlideToCanvas(targetCanvas, slide, bgColor) {
    return new Promise((resolve) => {
      targetCanvas.clear();
      targetCanvas.setBackgroundColor(bgColor, () => {
        if (slide.data && slide.data.objects && slide.data.objects.length > 0) {
          targetCanvas.loadFromJSON(slide.data, () => {
            targetCanvas.renderAll();
            resolve();
          });
        } else {
          targetCanvas.renderAll();
          resolve();
        }
      });
    });
  }

  /**
   * 투명 캔버스 뒤에 칠판 테마 배경색을 깔아서 PNG Base64로 추출
   */
  captureCanvasWithBackground(canvasInstance, backgroundColor) {
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = canvasInstance.width;
    exportCanvas.height = canvasInstance.height;
    const ctx = exportCanvas.getContext('2d');

    // 배경색 채우기
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

    // 판서 레이어 합성
    ctx.drawImage(canvasInstance.lowerCanvasEl, 0, 0);

    return exportCanvas.toDataURL('image/png');
  }
}

// 전역 인스턴스 등록
window.pdfExporter = new PdfExporter();