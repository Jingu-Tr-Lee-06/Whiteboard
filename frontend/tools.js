/**
 * tools.js
 * - 도구 관리 (펜, 지우개, 올가미)
 * - 닫힌 도형 검은색 채움 버그 방지 (fill: null 강제)
 * - 획 지우개(Stroke Eraser) 및 영역 지우개(Area Eraser) 정밀 판정
 */

class ToolManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.currentTool = 'pen'; // 'pen' | 'eraser' | 'lasso'
    this.eraseMode = 'stroke'; // 'stroke' | 'area'
    this.currentColor = '#FFFFFF';
    this.brushSize = 4;
    this.isErasingMouseDown = false;

    this.initCanvasSettings();
    this.bindEraserEvents();
  }

  /**
   * 브러시 초기 속성 세팅
   */
  initCanvasSettings() {
    this.canvas.isDrawingMode = false; // 기본값은 학생 모드에 맞춰 false 유지
    this.applyBrushSettings();
  }

  /**
   * 브러시 설정 적용
   * fill을 null로 지정하여 선 내부가 검게 칠해지는 문제 원천 차단
   */
  applyBrushSettings() {
    if (!this.canvas.freeDrawingBrush) {
      this.canvas.freeDrawingBrush = new fabric.PencilBrush(this.canvas);
    }
    this.canvas.freeDrawingBrush.color = this.currentColor;
    this.canvas.freeDrawingBrush.width = this.brushSize;
    this.canvas.freeDrawingBrush.fill = null;
    this.canvas.freeDrawingBrush.strokeLineCap = 'round';
    this.canvas.freeDrawingBrush.strokeLineJoin = 'round';
  }

  /**
   * 현재 도구 설정 (펜, 지우개, 올가미)
   */
  setTool(tool) {
    this.currentTool = tool;
    this.canvas.discardActiveObject();

    if (tool === 'pen') {
      this.canvas.isDrawingMode = true;
      this.canvas.selection = false;
      this.applyBrushSettings();
      this.canvas.defaultCursor = 'crosshair';
      this.canvas.forEachObject((obj) => {
        obj.selectable = false;
        obj.evented = false;
      });
    } else if (tool === 'eraser') {
      if (this.eraseMode === 'stroke') {
        // 획 단위 지우개: 수동 충돌 판정 모드
        this.canvas.isDrawingMode = false;
        this.canvas.selection = false;
        this.canvas.defaultCursor = 'crosshair';
        this.canvas.forEachObject((obj) => {
          obj.selectable = false;
          obj.evented = false;
        });
      } else {
        // 영역 단위 지우개: 투명 마스킹 브러시 모드
        this.canvas.isDrawingMode = true;
        this.canvas.selection = false;
        this.applyBrushSettings();
        this.canvas.freeDrawingBrush.width = this.brushSize * 3;
        this.canvas.defaultCursor = 'crosshair';
      }
    } else if (tool === 'lasso') {
      // 올가미 도구: 다중 선택 및 이동 모드
      this.canvas.isDrawingMode = false;
      this.canvas.selection = true;
      this.canvas.defaultCursor = 'default';
      this.canvas.forEachObject((obj) => {
        obj.selectable = true;
        obj.evented = true;
      });
    }

    this.canvas.requestRenderAll();
  }

  /**
   * 지우개 모드 변경 (획 지우기 / 영역 지우기)
   */
  setEraseMode(mode) {
    this.eraseMode = mode;
    if (this.currentTool === 'eraser') {
      this.setTool('eraser');
    }
  }

  /**
   * 펜 색상 변경
   */
  setColor(color) {
    this.currentColor = color;
    if (this.currentTool === 'pen') {
      this.applyBrushSettings();
    }
  }

  /**
   * 브러시 두께 변경
   */
  setSize(size) {
    this.brushSize = parseInt(size, 10);
    if (this.currentTool === 'pen') {
      this.applyBrushSettings();
    } else if (this.currentTool === 'eraser' && this.eraseMode === 'area') {
      this.canvas.freeDrawingBrush.width = this.brushSize * 3;
    }
  }

  /**
   * 지우개 마우스/터치 이벤트 리스너 바인딩
   */
  bindEraserEvents() {
    this.canvas.on('mouse:down', (e) => {
      if (this.currentTool === 'eraser' && this.eraseMode === 'stroke') {
        this.isErasingMouseDown = true;
        this.eraseObjectAtPoint(e);
      }
    });

    this.canvas.on('mouse:move', (e) => {
      if (this.currentTool === 'eraser' && this.eraseMode === 'stroke' && this.isErasingMouseDown) {
        this.eraseObjectAtPoint(e);
      }
    });

    this.canvas.on('mouse:up', () => {
      this.isErasingMouseDown = false;
    });

    // 새로 그려진 획의 fill 속성 즉각 제거 및 영역 지우개 블렌딩 처리
    this.canvas.on('path:created', (e) => {
      if (!e || !e.path) return;
      e.path.set({
        fill: null,
        strokeLineCap: 'round',
        strokeLineJoin: 'round'
      });

      if (this.currentTool === 'eraser' && this.eraseMode === 'area') {
        e.path.globalCompositeOperation = 'destination-out';
      }

      this.canvas.requestRenderAll();
    });
  }

  /**
   * 획 지우기: 포인터 좌표와 교차하는 객체 제거
   */
  eraseObjectAtPoint(e) {
    const pointer = this.canvas.getPointer(e.e);
    const objects = this.canvas.getObjects();
    let hasDeleted = false;

    for (let i = objects.length - 1; i >= 0; i--) {
      const obj = objects[i];
      if (!obj) continue;

      const hitBoxPadding = Math.max(10, this.brushSize * 2);
      const isInside = obj.containsPoint(pointer);
      const isIntersecting = obj.intersectsWithRect && obj.intersectsWithRect(
        new fabric.Point(pointer.x - hitBoxPadding, pointer.y - hitBoxPadding),
        new fabric.Point(pointer.x + hitBoxPadding, pointer.y + hitBoxPadding)
      );

      if (isInside || isIntersecting) {
        this.canvas.remove(obj);
        hasDeleted = true;
        break; // 한 번의 드래그 스텝에 하나씩 순차 제거하여 과부하 방지
      }
    }

    if (hasDeleted) {
      this.canvas.requestRenderAll();
      this.canvas.fire('object:modified');
    }
  }
}

window.ToolManager = ToolManager;