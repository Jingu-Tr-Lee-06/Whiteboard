/**
 * export_pdf.js
 * - 슬라이드 객체 및 배경 테마/모눈 격자 완벽 합성
 * - 비동기 렌더링 완료 대기 후 캡처하여 백지 출력 버그 해결
 * - jsPDF를 통한 다중 페이지 PDF 로컬 다운로드
 */

class PdfExporter {
  constructor() {
    this.themeStyles = {
      chalkboard: {
        bg: '#1e3d2f',
        grid: 'rgba(255, 255, 255, 0.05)'
      },
      whiteboard: {
        bg: '#f8fafc',
        grid: 'rgba(0, 0, 0, 0.04)'
      },
      blackboard: {
        bg: '#121212',
        grid: 'rgba(255, 255, 255, 0.06)'
      }
    };
  }

  /**
   * PDF 내보내기 메인 함수
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
      // 1. 현재 화면의 최신 판서 내용을 슬라이드 데이터에 동기화
      if (window.whiteboardApp && window.whiteboardApp.slideManager) {
        window.whiteboardApp.slideManager.saveCurrentSlideData();
      }

      const { jsPDF } = window.jspdf;
      const exportWidth = activeCanvas.width || window.innerWidth;
      const exportHeight = activeCanvas.height || window.innerHeight;

      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'px',
        format: [exportWidth, exportHeight]
      });

      // 2. 가상 렌더링용 임시 캔버스 생성
      const hiddenCanvasEl = document.createElement('canvas');
      hiddenCanvasEl.width = exportWidth;
      hiddenCanvasEl.height = exportHeight;

      const renderCanvas = new fabric.Canvas(hiddenCanvasEl, {
        width: exportWidth,
        height: exportHeight,
        enableRetinaScaling: false
      });

      // 3. 슬라이드 순회 렌더링
      for (let i = 0; i < slideKeys.length; i++) {
        const key = slideKeys[i];
        const slide = slides[key];
        const theme = slide.theme || 'chalkboard';
        const style = this.themeStyles[theme] || this.themeStyles.chalkboard;

        // 슬라이드 데이터 로드 대기
        await this.loadSlideAsync(renderCanvas, slide.data);

        // 배경색 + 모눈 격자 + 판서 레이어 병합 캡처
        const finalImgData = this.createMergedImage(renderCanvas, exportWidth, exportHeight, style);

        if (i > 0) {
          pdf.addPage([exportWidth, exportHeight], 'landscape');
        }
        pdf.addImage(finalImgData, 'PNG', 0, 0, exportWidth, exportHeight);
      }

      // 리소스 정리
      renderCanvas.dispose();

      // 4. 파일 다운로드
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
      const timeStr = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
      pdf.save(`스마트칠판_판서기록_${dateStr}_${timeStr}.pdf`);
    } catch (err) {
      console.error('PDF 생성 실패:', err);
      alert('PDF 생성 중 오류가 발생했습니다.');
    } finally {
      document.body.style.cursor = originalCursor;
    }
  }

  /**
   * 가상 캔버스에 JSON 데이터를 로드하고 비동기 렌더링 완료를 보장
   */
  loadSlideAsync(targetCanvas, slideData) {
    return new Promise((resolve) => {
      targetCanvas.clear();
      targetCanvas.setViewportTransform([1, 0, 0, 1, 0, 0]); // 줌/패닝 초기화

      if (slideData && slideData.objects && slideData.objects.length > 0) {
        // 객체 채움 속성 안전 보정
        slideData.objects.forEach((obj) => {
          obj.fill = null;
        });

        targetCanvas.loadFromJSON(slideData, () => {
          targetCanvas.renderAll();
          resolve();
        });
      } else {
        targetCanvas.renderAll();
        resolve();
      }
    });
  }

  /**
   * 칠판 배경색, 모눈 격자 패턴 및 판서 객체를 하나의 2D 캔버스에 합성
   */
  createMergedImage(fabricCanvas, width, height, style) {
    const mergeCanvas = document.createElement('canvas');
    mergeCanvas.width = width;
    mergeCanvas.height = height;
    const ctx = mergeCanvas.getContext('2d');

    // 1. 기본 테마 배경색 칠하기
    ctx.fillStyle = style.bg;
    ctx.fillRect(0, 0, width, height);

    // 2. 미세 모눈 격자(Grid) 그리기 (간격: 40px)
    ctx.strokeStyle = style.grid;
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

    // 3. 판서 객체 레이어 복사 합성
    ctx.drawImage(fabricCanvas.lowerCanvasEl, 0, 0);

    return mergeCanvas.toDataURL('image/png');
  }
}

window.pdfExporter = new PdfExporter();