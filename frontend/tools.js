/**
 * tools.js - 완전 재설계 버전
 * - 펜, 획 지우개, 영역 지우개, 올가미(선택/이동) 도구 제어
 * - fill: null 강제로 닫힌 곡선 내부 검은색 채움 버그 원천 차단
 * - 정밀 충돌 판정 기반 획 지우개(Stroke Eraser)
 */

class ToolManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.currentTool = 'pen'; // 'pen' | 'eraser' | 'lasso'
    this.eraseMode = 'stroke'; // 'stroke' | 'area'
    this.currentColor = '#FFFFFF';
    this.brushSize = 4;
    this.isErasing = false;

    this.initBrush();
    this.bindEvents();
  }

  /**
   * 브러시 기본 속성 세팅
   */
  initBrush() {
    if (!this.canvas.freeDrawingBrush) {
      this.canvas.freeDrawingBrush = new fabric.PencilBrush(this.canvas);
    }
    this.updateBrushProperties();
  }

  /**
   * 색상, 두께, 라인 캡 설정 동기화
   */
  updateBrushProperties() {
    if (!this.canvas.freeDrawingBrush) return;

    this.canvas.freeDrawingBrush.color = this.currentColor;
    this.canvas.freeDrawingBrush.width = parseInt(this.brushSize, 10);
    this.canvas.freeDrawingBrush.strokeLineCap = 'round';
    this.canvas.freeDrawingBrush.strokeLineJoin = 'round';
    this.canvas.freeDrawingBrush.fill = null; // 채움 버그 방지
  }

  /**
   * 도구 전환 메인 메서드
   */
  setTool(tool) {
    this.currentTool = tool;
    this.canvas.discardActiveObject();

    if (tool === 'pen') {
      this.canvas.isDrawingMode = true;
      this.canvas.selection = false;
      this.canvas.defaultCursor = 'crosshair';
      this.canvas.freeDrawingCursor = 'crosshair';

      this.updateBrushProperties();

      // 객체 개별 선택 비활성화
      this.canvas.forEachObject((obj) => {
        obj.selectable = false;
        obj.evented = false;
      });
    } else if (tool === 'eraser') {
      if (this.eraseMode === 'stroke') {
        // 획 지우개: 드로잉 모드를 끄고 직접 포인터 충돌 판정 수행
        this.canvas.isDrawingMode = false;
        this.canvas.selection = false;
        this.canvas.defaultCursor = 'cell';

        this.canvas.forEachObject((obj) => {
          obj.selectable = false;
          obj.evented = false;
        });
      } else {
        // 영역 지우개: 지우개 브러시 모드
        this.canvas.isDrawingMode = true;
        this.canvas.selection = false;
        this.canvas.defaultCursor = 'crosshair';
        this.canvas.freeDrawingCursor = 'crosshair';

        this.canvas.freeDrawingBrush.width = parseInt(this.brushSize, 10) * 4;
        this.canvas.freeDrawingBrush.color = '#000000'; // 합성 연산용
      }
    } else if (tool === 'lasso') {
      // 올가미: 판서 개체 선택 및 이동/변형 허용
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
   * 지우개 모드 변경 (획 / 영역)
   */
  setEraseMode(mode) {
    this.eraseMode = mode;
    if (this.currentTool === 'eraser') {
      this.setTool('eraser');
    }
  }

  /**
   * 색상 지정
   */
  setColor(color) {
    this.currentColor = color;
    if (this.currentTool === 'pen') {
      this.updateBrushProperties();
    }
  }

  /**
   * 두께 지정
   */
  setSize(size) {
    this.brushSize = parseInt(size, 10);
    if (this.currentTool === 'pen') {
      this.updateBrushProperties();
    } else if (this.currentTool === 'eraser' && this.eraseMode === 'area') {
      this.canvas.freeDrawingBrush.width = this.brushSize * 4;
    }
  }

  /**
   * 이벤트 바인딩
   */
  bindEvents() {
    // 획 생성 시 속성 보정 및 영역 지우개 합성 모드 처리
    this.canvas.on('path:created', (opt) => {
      if (!opt || !opt.path) return;

      const path = opt.path;
      path.set({
        fill: null,
        strokeLineCap: 'round',
        strokeLineJoin: 'round',
        selectable: this.currentTool === 'lasso',
        evented: this.currentTool === 'lasso'
      });

      if (this.currentTool === 'eraser' && this.eraseMode === 'area') {
        path.globalCompositeOperation = 'destination-out';
      }

      this.canvas.requestRenderAll();
    });

    // 획 지우개 마우스 이벤트
    this.canvas.on('mouse:down', (opt) => {
      if (this.currentTool === 'eraser' && this.eraseMode === 'stroke') {
        this.isErasing = true;
        this.eraseAtPointer(opt);
      }
    });

    this.canvas.on('mouse:move', (opt) => {
      if (this.isErasing && this.currentTool === 'eraser' && this.eraseMode === 'stroke') {
        this.eraseAtPointer(opt);
      }
    });

    const stopErasing = () => {
      this.isErasing = false;
    };
    this.canvas.on('mouse:up', stopErasing);
  }

  /**
   * 포인터 위치 기반 객체 충돌 판정 및 삭제
   */
  eraseAtPointer(opt) {
    const pointer = this.canvas.getPointer(opt.e);
    const objects = this.canvas.getObjects();
    let removed = false;

    for (let i = objects.length - 1; i >= 0; i--) {
      const target = objects[i];
      if (!target) continue;

      const hitBox = Math.max(12, this.brushSize * 2);
      const isPointInside = target.containsPoint(pointer);
      const intersects = target.intersectsWithRect && target.intersectsWithRect(
        new fabric.Point(pointer.x - hitBox, pointer.y - hitBox),
        new fabric.Point(pointer.x + hitBox, pointer.y + hitBox)
      );

      if (isPointInside || intersects) {
        this.canvas.remove(target);
        removed = true;
        break; // 루프당 1개씩 순차 삭제하여 프레임 드랍 방지
      }
    }

    if (removed) {
      this.canvas.requestRenderAll();
      this.canvas.fire('object:modified');
    }
  }
}

window.ToolManager = ToolManager;