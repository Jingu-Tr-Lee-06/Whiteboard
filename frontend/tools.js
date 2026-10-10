/**
 * tools.js
 * - 도구 엔진: 펜(Pen), 지우개(Eraser), 자유 곡선 올가미(Lasso)
 * - 원형 지우개 인디케이터 포인터 및 실시간 교차 지우개 로직
 * - 폴리곤(다각형) 기반 자유 영역 올가미 선택 로직
 */

class ToolManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.currentTool = 'pen'; // 'pen' | 'eraser' | 'lasso'
    this.eraseMode = 'stroke'; // 'stroke' | 'area'
    this.currentColor = '#FFFFFF';
    this.currentSize = 4;
    this.eraserRadius = 16;

    // 자유 곡선 올가미 관련 변수
    this.isLassoing = false;
    this.lassoPoints = [];
    this.lassoPolyline = null;

    // 지우개 가이드 커서 엘리먼트
    this.eraserCursorEl = document.getElementById('eraser-cursor');

    this.isErasing = false;

    this.initListeners();
    this.setTool('pen');
  }

  initListeners() {
    const upperCanvas = this.canvas.upperCanvasEl;
    if (!upperCanvas) return;

    // 지우개 원형 포인터 추적
    upperCanvas.addEventListener('pointermove', (e) => {
      this.updateEraserCursorPosition(e);
      if (this.currentTool === 'eraser' && this.isErasing) {
        this.eraseAtPoint(this.canvas.getPointer(e));
      }
    });

    upperCanvas.addEventListener('pointerenter', () => {
      if (this.currentTool === 'eraser' && this.eraserCursorEl) {
        this.eraserCursorEl.style.display = 'block';
      }
    });

    upperCanvas.addEventListener('pointerleave', () => {
      if (this.eraserCursorEl) {
        this.eraserCursorEl.style.display = 'none';
      }
      this.isErasing = false;
    });

    // 캔버스 마우스/펜 다운
    this.canvas.on('mouse:down', (opt) => {
      if (!window.whiteboardApp || !window.whiteboardApp.isProfessor) return;

      if (this.currentTool === 'eraser') {
        this.isErasing = true;
        this.eraseAtPoint(this.canvas.getPointer(opt.e));
      } else if (this.currentTool === 'lasso') {
        const target = this.canvas.findTarget(opt.e, false);
        // 이미 선택된 그룹을 드래그 중인 경우는 새 올가미를 그리지 않음
        if (target && this.canvas.getActiveObject()) {
          return;
        }
        this.startLasso(this.canvas.getPointer(opt.e));
      }
    });

    // 캔버스 마우스/펜 이동 (올가미 궤적)
    this.canvas.on('mouse:move', (opt) => {
      if (this.currentTool === 'lasso' && this.isLassoing) {
        this.addLassoPoint(this.canvas.getPointer(opt.e));
      }
    });

    // 캔버스 마우스/펜 업 (동작 종료)
    this.canvas.on('mouse:up', () => {
      if (this.currentTool === 'eraser') {
        this.isErasing = false;
        if (window.whiteboardApp && window.whiteboardApp.firebaseSync) {
          window.whiteboardApp.firebaseSync.broadcastCurrentState();
        }
      } else if (this.currentTool === 'lasso' && this.isLassoing) {
        this.finishLasso();
      }
    });
  }

  /**
   * 도구 전환
   */
  setTool(tool) {
    this.currentTool = tool;
    this.canvas.isDrawingMode = false;
    this.canvas.selection = false;

    // 지우개 커서 토글
    if (tool === 'eraser') {
      if (this.eraserCursorEl) {
        this.eraserCursorEl.style.display = 'block';
        this.updateEraserCursorSize();
      }
      this.canvas.defaultCursor = 'none';
      this.canvas.discardActiveObject();
      this.canvas.requestRenderAll();
    } else {
      if (this.eraserCursorEl) {
        this.eraserCursorEl.style.display = 'none';
      }

      if (tool === 'pen') {
        this.canvas.isDrawingMode = window.whiteboardApp ? window.whiteboardApp.isProfessor : false;
        this.canvas.defaultCursor = 'crosshair';
        this.canvas.freeDrawingBrush = new fabric.PencilBrush(this.canvas);
        this.canvas.freeDrawingBrush.color = this.currentColor;
        this.canvas.freeDrawingBrush.width = parseInt(this.currentSize, 10);
        this.canvas.discardActiveObject();
        this.canvas.requestRenderAll();
      } else if (tool === 'lasso') {
        this.canvas.defaultCursor = 'crosshair';
      }
    }
  }

  setColor(color) {
    this.currentColor = color;
    if (this.currentTool === 'pen' && this.canvas.freeDrawingBrush) {
      this.canvas.freeDrawingBrush.color = color;
    }
  }

  setSize(size) {
    this.currentSize = parseInt(size, 10);
    this.eraserRadius = Math.max(10, this.currentSize * 2);

    if (this.currentTool === 'pen' && this.canvas.freeDrawingBrush) {
      this.canvas.freeDrawingBrush.width = this.currentSize;
    }

    this.updateEraserCursorSize();
  }

  setEraseMode(mode) {
    this.eraseMode = mode;
  }

  /**
   * 지우개 커서 위치 갱신 (스크린 좌표계)
   */
  updateEraserCursorPosition(e) {
    if (!this.eraserCursorEl || this.currentTool !== 'eraser') return;
    this.eraserCursorEl.style.left = `${e.clientX}px`;
    this.eraserCursorEl.style.top = `${e.clientY}px`;
  }

  /**
   * 지우개 원형 커서 지름 갱신 (현재 캔버스 줌 배율 반영)
   */
  updateEraserCursorSize() {
    if (!this.eraserCursorEl) return;
    const zoom = this.canvas.getZoom() || 1;
    const diameter = this.eraserRadius * 2 * zoom;
    this.eraserCursorEl.style.width = `${diameter}px`;
    this.eraserCursorEl.style.height = `${diameter}px`;
  }

  /**
   * 포인트 기반 지우개 삭제 판정 로직
   */
  eraseAtPoint(point) {
    const objects = this.canvas.getObjects();
    if (!objects.length) return;

    let modified = false;
    const radius = this.eraserRadius;

    for (let i = objects.length - 1; i >= 0; i--) {
      const obj = objects[i];

      // 고정 배경이나 클리핑 객체는 제외
      if (obj === this.canvas.clipPath) continue;

      // 1. 획 단위 지우개: 지우개 반경 내에 획의 바운딩 박스/포인트가 닿으면 즉시 획 전체 삭제
      if (this.eraseMode === 'stroke') {
        if (this.isObjectHitByCircle(obj, point, radius)) {
          this.canvas.remove(obj);
          modified = true;
        }
      }
      // 2. 영역 지우기: 반경 내에 겹치는 경우 삭제 처리
      else if (this.eraseMode === 'area') {
        if (this.isObjectHitByCircle(obj, point, radius)) {
          this.canvas.remove(obj);
          modified = true;
        }
      }
    }

    if (modified) {
      this.canvas.requestRenderAll();
    }
  }

  /**
   * 원과 오브젝트 간의 충돌 검사
   */
  isObjectHitByCircle(obj, circleCenter, radius) {
    const bound = obj.getBoundingRect(true, true);
    // 바운딩 박스 1차 필터링
    if (
      circleCenter.x + radius < bound.left ||
      circleCenter.x - radius > bound.left + bound.width ||
      circleCenter.y + radius < bound.top ||
      circleCenter.y - radius > bound.top + bound.height
    ) {
      return false;
    }

    // Fabric Path 객체인 경우 정밀 세그먼트 거리 검사
    if (obj.path && Array.isArray(obj.path)) {
      for (let j = 0; j < obj.path.length; j++) {
        const seg = obj.path[j];
        const px = seg[seg.length - 2];
        const py = seg[seg.length - 1];
        if (typeof px === 'number' && typeof py === 'number') {
          const dx = px - circleCenter.x;
          const dy = py - circleCenter.y;
          if (dx * dx + dy * dy <= radius * radius) {
            return true;
          }
        }
      }
    }

    return true;
  }

  /**
   * 자유 곡선 올가미 시작
   */
  startLasso(point) {
    this.isLassoing = true;
    this.lassoPoints = [{ x: point.x, y: point.y }];

    this.lassoPolyline = new fabric.Polyline(this.lassoPoints, {
      stroke: '#38bdf8',
      strokeWidth: 2,
      strokeDashArray: [6, 4],
      fill: 'rgba(56, 189, 248, 0.15)',
      selectable: false,
      evented: false
    });

    this.canvas.add(this.lassoPolyline);
  }

  /**
   * 올가미 궤적 추가
   */
  addLassoPoint(point) {
    this.lassoPoints.push({ x: point.x, y: point.y });
    if (this.lassoPolyline) {
      this.canvas.remove(this.lassoPolyline);
      this.lassoPolyline = new fabric.Polyline(this.lassoPoints, {
        stroke: '#38bdf8',
        strokeWidth: 2,
        strokeDashArray: [6, 4],
        fill: 'rgba(56, 189, 248, 0.15)',
        selectable: false,
        evented: false
      });
      this.canvas.add(this.lassoPolyline);
      this.canvas.requestRenderAll();
    }
  }

  /**
   * 올가미 폐곡선 계산 및 내부 객체 그룹 선택
   */
  finishLasso() {
    this.isLassoing = false;
    if (this.lassoPolyline) {
      this.canvas.remove(this.lassoPolyline);
      this.lassoPolyline = null;
    }

    if (this.lassoPoints.length < 3) {
      this.lassoPoints = [];
      this.canvas.requestRenderAll();
      return;
    }

    const enclosedObjects = [];
    const allObjects = this.canvas.getObjects();

    for (let i = 0; i < allObjects.length; i++) {
      const obj = allObjects[i];
      if (obj === this.canvas.clipPath) continue;

      const center = obj.getCenterPoint();
      // 다각형 내부 포함 판정 (Ray-Casting Algorithm)
      if (this.isPointInsidePolygon(center, this.lassoPoints)) {
        enclosedObjects.push(obj);
      }
    }

    if (enclosedObjects.length > 0) {
      const selection = new fabric.ActiveSelection(enclosedObjects, {
        canvas: this.canvas
      });
      this.canvas.setActiveObject(selection);
      this.canvas.requestRenderAll();
    } else {
      this.canvas.discardActiveObject();
      this.canvas.requestRenderAll();
    }

    this.lassoPoints = [];
  }

  /**
   * Ray-Casting 기반 다각형 내부 포함 알고리즘
   */
  isPointInsidePolygon(p, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x;
      const yi = poly[i].y;
      const xj = poly[j].x;
      const yj = poly[j].y;

      const intersect =
        yi > p.y !== yj > p.y &&
        p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }
}

window.ToolManager = ToolManager;