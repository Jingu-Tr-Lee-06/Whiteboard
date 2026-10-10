/**
 * export_pdf.js
 * - 고정 1920 x 1080 규격 PDF 내보내기
 * - 나무 프레임 + 격자 + 판서 온전 병합
 */

class PdfExporter {
  constructor() {
    this.themePalette = {
      chalkboard: '#1e3d2f',
      whiteboard: '#f8fafc',
      blackboard: '#141414'
    };

    this.gridPalette = {
      chalkboard: 'rgba(255, 255, 255, 0.08)',
      whiteboard: 'rgba(0, 0, 0, 0.07)',
      blackboard: 'rgba(255, 255, 255, 0.09)'
    };
  }

  async exportSlides(slides, boardWidth, boardHeight, frameThickness) {
    const slideKeys = Object.keys(slides);
    if (!slideKeys.length) {
      alert('저장할 슬라이드가 없습니다.');
      return;
    }

    const originalCursor = document.body.style.cursor;
    document.body.style.cursor = 'wait';

    try {
      if (window.whiteboardApp && window.whiteboardApp.slideManager) {
        window.whiteboardApp.slideManager.saveCurrentSlideData();
      }

      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'px',
        format: [boardWidth, boardHeight]
      });

      const hiddenEl = document.createElement('canvas');
      hiddenEl.width = boardWidth;
      hiddenEl.height = boardHeight;

      const virtualCanvas = new fabric.Canvas(hiddenEl, {
        width: boardWidth,
        height: boardHeight,
        enableRetinaScaling: false
      });

      for (let i = 0; i < slideKeys.length; i++) {
        const key = slideKeys[i];
        const slide = slides[key];
        const theme = slide.theme || 'chalkboard';

        await this.loadSlideIntoCanvas(virtualCanvas, slide.data);

        const imgData = this.renderMergedImage(
          virtualCanvas,
          boardWidth,
          boardHeight,
          frameThickness,
          theme
        );

        if (i > 0) {
          pdf.addPage([boardWidth, boardHeight], 'landscape');
        }
        pdf.addImage(imgData, 'PNG', 0, 0, boardWidth, boardHeight);
      }

      virtualCanvas.dispose();

      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
      const timeStr = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
      pdf.save(`스마트칠판_강의록_${dateStr}_${timeStr}.pdf`);
    } catch (err) {
      console.error('PDF 내보내기 에러:', err);
      alert('PDF 생성 중 오류가 발생했습니다.');
    } finally {
      document.body.style.cursor = originalCursor;
    }
  }

  loadSlideIntoCanvas(canvasInstance, slideData) {
    return new Promise((resolve) => {
      canvasInstance.clear();
      canvasInstance.setViewportTransform([1, 0, 0, 1, 0, 0]);

      if (slideData && slideData.objects && slideData.objects.length > 0) {
        const sanitizedObjects = slideData.objects.map((obj) => Object.assign({}, obj, { fill: null }));
        const sanitizedData = Object.assign({}, slideData, { objects: sanitizedObjects });

        canvasInstance.loadFromJSON(sanitizedData, () => {
          canvasInstance.renderAll();
          requestAnimationFrame(() => resolve());
        });
      } else {
        canvasInstance.renderAll();
        requestAnimationFrame(() => resolve());
      }
    });
  }

  renderMergedImage(canvasInstance, w, h, ft, theme) {
    const outCanvas = document.createElement('canvas');
    outCanvas.width = w;
    outCanvas.height = h;
    const ctx = outCanvas.getContext('2d');

    // 1. 나무 테두리
    ctx.fillStyle = '#5c3a21';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#7a4e2d';
    ctx.fillRect(0, 0, w, ft / 3);
    ctx.fillRect(0, 0, ft / 3, h);

    ctx.fillStyle = '#3d2514';
    ctx.fillRect(0, h - ft / 3, w, ft / 3);
    ctx.fillRect(w - ft / 3, 0, ft / 3, h);

    // 2. 내부 배경
    ctx.fillStyle = this.themePalette[theme] || this.themePalette.chalkboard;
    ctx.fillRect(ft, ft, w - ft * 2, h - ft * 2);

    // 3. 모눈 격자
    ctx.save();
    ctx.beginPath();
    ctx.rect(ft, ft, w - ft * 2, h - ft * 2);
    ctx.clip();

    ctx.strokeStyle = this.gridPalette[theme] || this.gridPalette.chalkboard;
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

    // 4. 판서 레이어
    ctx.drawImage(canvasInstance.lowerCanvasEl, 0, 0, w, h);

    return outCanvas.toDataURL('image/png');
  }
}

window.pdfExporter = new PdfExporter();