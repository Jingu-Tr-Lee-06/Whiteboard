/**
 * tools.js - 선 내부 검은색 채움 방지(fill: null) 및 지우개 모듈
 */

class ToolManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.currentTool = 'pen';
    this.eraseMode = 'stroke';
    this.currentColor = '#FFFFFF';
    this.brushSize = 4;
    this.isErasingMouseDown = false;

    this.initCanvasSettings();
    this.bindEraserEvents();
  }

  initCanvasSettings() {
    this.canvas.isDrawingMode = true;
    this.applyBrushSettings();
  }

  applyBrushSettings() {
    if (!this.canvas.freeDrawingBrush) {
      this.canvas.freeDrawingBrush = new fabric.PencilBrush(this.canvas);
    }
    this.canvas.freeDrawingBrush.color = this.currentColor;
    this.canvas.freeDrawingBrush.width = this.brushSize;
    // 닫힌 루프 내부가 검은색으로 채워지는 현상 방지
    this.canvas.freeDrawingBrush.fill = null;
  }

  setTool(tool) {
    this.currentTool = tool;
    this.canvas.discardActiveObject();

    if (tool === 'pen') {
      this.canvas.isDrawingMode = true;
      this.canvas.selection = false;
      this.applyBrushSettings();
      this.canvas.defaultCursor = 'crosshair';
    } 
    else if (tool === 'eraser') {
      if (this.eraseMode === 'stroke') {
        this.canvas.isDrawingMode = false;
        this.canvas.selection = false;
        this.canvas.defaultCursor = 'crosshair';
      } else {
        this.canvas.isDrawingMode = true;
        this.applyBrushSettings();
        this.canvas.freeDrawingBrush.width = this.brushSize * 3;
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
      this.applyBrushSettings();
    }
  }

  setSize(size) {
    this.brushSize = parseInt(size, 10);
    if (this.currentTool === 'pen') {
      this.applyBrushSettings();
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

    // 획이 그려지는 즉시 fill을 null로 강제 보정
    this.canvas.on('path:created', (e) => {
      if (e.path) {
        e.path.set({ fill: null });
        if (this.currentTool === 'eraser' && this.eraseMode === 'area') {
          e.path.globalCompositeOperation = 'destination-out';
        }
        this.canvas.renderAll();
      }
    });
  }

  eraseObjectAtPoint(e) {
    const pointer = this.canvas.getPointer(e.e);
    const objects = this.canvas.getObjects();
    let hasDeleted = false;

    for (let i = objects.length - 1; i >= 0; i--) {
      const obj = objects[i];
      if (!obj) continue;

      if (obj.containsPoint(pointer) || (obj.intersectsWithRect && obj.intersectsWithRect(
        new fabric.Point(pointer.x - 10, pointer.y - 10),
        new fabric.Point(pointer.x + 10, pointer.y + 10)
      ))) {
        this.canvas.remove(obj);
        hasDeleted = true;
        break;
      }
    }

    if (hasDeleted) {
      this.canvas.requestRenderAll();
      this.canvas.fire('object:modified');
    }
  }
}

window.ToolManager = ToolManager;