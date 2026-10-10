/**
 * export_pdf.js - 로컬 브라우저 기반 다중 슬라이드 고해상도 PDF 일괄 내보내기 모듈
 * Cloud Storage 없이 순수 jsPDF 연산으로 기기에 즉시 저장
 */

class PDFExporter {
  constructor() {
    this.virtualCanvas = null;
  }

  getVirtualCanvas(width, height) {
    if (!this.virtualCanvas) {
      const el = document.createElement('canvas');
      el.width = width;
      el.height = height;
      this.virtualCanvas = new fabric.Canvas(el, {
        renderOnAddRemove: false,
        selection: false,
        skipOffscreen: false
      });
    } else {
      this.virtualCanvas.setWidth(width);
      this.virtualCanvas.setHeight(height);
    }
    return this.virtualCanvas;
  }

  getBackgroundColor(themeKey) {
    switch (themeKey) {
      case 'whiteboard':
        return '#ffffff';
      case 'blackboard':
        return '#121212';
      case 'chalkboard':
      default:
        return '#1e3d2f';
    }
  }

  async exportSlides(slidesMap, currentActiveId, activeCanvas, fileNamePrefix = '강의_판서본') {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      alert('PDF 변환 엔진(jsPDF)을 로드하지 못했습니다.');
      return;
    }

    const { jsPDF } = window.jspdf;

    const pdf = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4',
      compress: true
    });

    const slideEntries = Object.values(slidesMap);
    if (slideEntries.length === 0) {
      alert('저장할 칠판 내용이 없습니다.');
      return;
    }

    const renderWidth = 1920;
    const renderHeight = 1080;
    const vCanvas = this.getVirtualCanvas(renderWidth, renderHeight);

    const exportBtn = document.getElementById('btn-action-export-pdf');
    const originalText = exportBtn ? exportBtn.innerHTML : '';
    if (exportBtn) {
      exportBtn.disabled = true;
      exportBtn.innerHTML = '⏳ PDF 생성 중...';
    }

    try {
      for (let i = 0; i < slideEntries.length; i++) {
        const slide = slideEntries[i];
        const bgColor = this.getBackgroundColor(slide.theme || 'chalkboard');
        let pageImgData = null;

        if (slide.id === currentActiveId && activeCanvas) {
          const origBg = activeCanvas.backgroundColor;
          activeCanvas.backgroundColor = bgColor;
          activeCanvas.renderAll();

          pageImgData = activeCanvas.toDataURL({
            format: 'jpeg',
            quality: 0.95,
            multiplier: renderWidth / activeCanvas.getWidth()
          });

          activeCanvas.backgroundColor = origBg;
          activeCanvas.renderAll();
        } else {
          vCanvas.clear();
          vCanvas.backgroundColor = bgColor;

          if (slide.data && slide.data.objects && slide.data.objects.length > 0) {
            await new Promise((resolve) => {
              vCanvas.loadFromJSON(slide.data, () => {
                vCanvas.renderAll();
                resolve();
              });
            });
          } else {
            vCanvas.renderAll();
          }

          pageImgData = vCanvas.toDataURL({
            format: 'jpeg',
            quality: 0.95
          });
        }

        if (i > 0) {
          pdf.addPage('a4', 'landscape');
        }

        pdf.addImage(pageImgData, 'JPEG', 0, 0, 297, 210, undefined, 'FAST');
      }

      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
      const timeStr = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
      const finalFileName = `${fileNamePrefix}_${dateStr}_${timeStr}.pdf`;

      pdf.save(finalFileName);

    } catch (err) {
      console.error('PDF 다운로드 실패:', err);
      alert('PDF 생성 도중 문제가 발생했습니다: ' + err.message);
    } finally {
      if (exportBtn) {
        exportBtn.disabled = false;
        exportBtn.innerHTML = originalText;
      }
    }
  }
}

window.pdfExporter = new PDFExporter();