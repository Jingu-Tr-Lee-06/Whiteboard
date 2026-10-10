/**
 * tools.js - 지우개 블렌딩 오류 및 획 지우기 판정 전면 수정본
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

  initCanvasSettings() {
    this.canvas.isDrawingMode = true;
    this.canvas.freeDrawingBrush.color = this.currentColor;
    this.canvas.freeDrawingBrush.width = this.brushSize;
  }

  setTool(tool) {
    this.currentTool = tool;
    this.canvas.discardActiveObject();

    if (tool === 'pen') {
      this.canvas.isDrawingMode = true;
      this.canvas.selection = false;
      this.canvas.freeDrawingBrush = new fabric.PencilBrush(this.canvas);
      this.canvas.freeDrawingBrush.color = this.currentColor;
      this.canvas.freeDrawingBrush.width = this.brushSize;
      this.canvas.defaultCursor = 'crosshair';
    } 
    else if (tool === 'eraser') {
      if (this.eraseMode === 'stroke') {
        // 획 지우개: 드로잉 모드를 끄고 마우스/펜 드래그로 충돌 객체 직접 삭제
        this.canvas.isDrawingMode = false;
        this.canvas.selection = false;
        this.canvas.defaultCursor = 'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'24\' height=\'24\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'white\' stroke-width=\'2\'><circle cx=\'12\' cy=\'12\' r=\'10\' fill=\'rgba(255,255,255,0.3)\'/></svg>") 12 12, auto';
      } else {
        // 영역 지우개: Fabric.js 전용 EraserBrush 또는 투명 블렌딩
        this.canvas.isDrawingMode = true;
        this.canvas.freeDrawingBrush = new fabric.PencilBrush(this.canvas);
        // 검은색이 칠해지지 않도록 투명 처리
        this.canvas.freeDrawingBrush.color = 'rgba(0,0,0,1)';
        this.canvas.freeDrawingBrush.width = this.brushSize * 3;
        // destination-out 강제 주입
        if (this.canvas.contextTop) {
          this.canvas.contextTop.globalCompositeOperation = 'destination-out';
        }
      }
    } 
    else if (tool === 'lasso') {
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

  setEraseMode(mode) {
    this.eraseMode = mode;
    if (this.currentTool === 'eraser') {
      this.setTool('eraser');
    }
  }

  setColor(color) {
    this.currentColor = color;
    if (this.currentTool === 'pen') {
      this.canvas.freeDrawingBrush.color = color;
    }
  }

  setSize(size) {
    this.brushSize = parseInt(size, 10);
    if (this.currentTool === 'pen') {
      this.canvas.freeDrawingBrush.width = this.brushSize;
    } else if (this.currentTool === 'eraser' && this.eraseMode === 'area') {
      this.canvas.freeDrawingBrush.width = this.brushSize * 3;
    }
  }

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

    // 영역 지우개 사용 후 블렌딩 모드 원복 및 저장 유도
    this.canvas.on('path:created', (e) => {
      if (this.currentTool === 'eraser' && this.eraseMode === 'area') {
        const path = e.path;
        path.globalCompositeOperation = 'destination-out';
        this.canvas.renderAll();
      }
    });
  }

  eraseObjectAtPoint(e) {
    const pointer = this.canvas.getPointer(e.e);
    const objects = this.canvas.getObjects();
    let hasDeleted = false;

    // 역순 순회하여 맨 위 획부터 감지 및 삭제
    for (let i = objects.length - 1; i >= 0; i--) {
      const obj = objects[i];
      if (!obj) continue;

      // 두께를 고려한 바운딩 박스 충돌 판정
      if (obj.containsPoint(pointer) || (obj.intersectsWithRect && obj.intersectsWithRect(
        new fabric.Point(pointer.x - 8, pointer.y - 8),
        new fabric.Point(pointer.x + 8, pointer.y + 8)
      ))) {
        this.canvas.remove(obj);
        hasDeleted = true;
        break; // 한 번에 한 획씩 깔끔하게 제거
      }
    }

    if (hasDeleted) {
      this.canvas.requestRenderAll();
      // 동기화 트리거 이벤트 발생
      this.canvas.fire('object:modified');
    }
  }
}

window.ToolManager = ToolManager;