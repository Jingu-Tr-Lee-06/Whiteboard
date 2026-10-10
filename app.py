import streamlit as st
import streamlit.components.v1 as components
import json

st.set_page_config(
    page_title="스마트 칠판 - 학생용 뷰어",
    page_icon="🖥️",
    layout="wide",
    initial_sidebar_state="collapsed",
)

st.markdown(
    """
    <style>
        html, body, [data-testid="stAppViewContainer"], .main, .block-container {
            padding: 0 !important;
            margin: 0 !important;
            width: 100vw !important;
            height: 100vh !important;
            max-width: 100% !important;
            overflow: hidden !important;
        }
        header[data-testid="stHeader"], footer {
            display: none !important;
        }
        iframe {
            display: block;
            width: 100vw !important;
            height: 100vh !important;
            border: none;
        }
    </style>
    """,
    unsafe_allow_html=True,
)

fb_secrets = st.secrets.get("firebase", {})
fb_config = {
    "apiKey": fb_secrets.get("apiKey") or fb_secrets.get("api_key", ""),
    "authDomain": fb_secrets.get("authDomain") or fb_secrets.get("auth_domain", ""),
    "databaseURL": fb_secrets.get("databaseURL") or fb_secrets.get("database_url", ""),
    "projectId": fb_secrets.get("projectId") or fb_secrets.get("project_id", ""),
    "storageBucket": fb_secrets.get("storageBucket") or fb_secrets.get("storage_bucket", ""),
    "messagingSenderId": fb_secrets.get("messagingSenderId") or fb_secrets.get("messaging_sender_id", ""),
    "appId": fb_secrets.get("appId") or fb_secrets.get("app_id", ""),
}
room_id = st.secrets.get("whiteboard", {}).get("room_id", "default_room")

viewer_html = f"""
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <style>
    * {{
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      user-select: none;
      -webkit-user-select: none;
    }}
    html, body {{
      width: 100%;
      height: 100%;
      overflow: hidden;
      background-color: #121214;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }}

    /* 상단 미니멀 네비게이션 & 상태바 */
    #nav-bar {{
      position: absolute;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(30, 34, 42, 0.9);
      backdrop-filter: blur(10px);
      padding: 5px 12px;
      border-radius: 24px;
      border: 1px solid rgba(255, 255, 255, 0.15);
      font-size: 12px;
      color: #E0E0E0;
      display: flex;
      align-items: center;
      gap: 8px;
      z-index: 100;
      box-shadow: 0 4px 14px rgba(0,0,0,0.5);
      white-space: nowrap;
    }}

    .badge {{
      display: inline-block;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background-color: #4CAF50;
      box-shadow: 0 0 6px #4CAF50;
    }}
    .badge.disconnected {{
      background-color: #F44336;
      box-shadow: 0 0 6px #F44336;
    }}

    /* 슬라이드 컨트롤 UI */
    .nav-btn {{
      background: #263238;
      border: 1px solid rgba(255,255,255,0.2);
      color: #E0E0E0;
      padding: 3px 8px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 11px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s ease;
    }}
    .nav-btn:hover {{
      background: #37474F;
      color: #FFF;
    }}

    #slide-select {{
      background: #263238;
      border: 1px solid rgba(255, 255, 255, 0.25);
      color: #E0E0E0;
      padding: 2px 6px;
      border-radius: 6px;
      font-size: 11px;
      outline: none;
      cursor: pointer;
    }}

    /* 교수자 라이브 동기화 토글 버튼 */
    #live-sync-btn {{
      background: #2E7D32;
      border: 1px solid #81C784;
      color: #FFF;
      font-weight: bold;
      padding: 3px 8px;
      border-radius: 12px;
      font-size: 11px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 4px;
      transition: all 0.2s;
    }}
    #live-sync-btn.off {{
      background: #424242;
      border: 1px solid #757575;
      color: #BDBDBD;
      font-weight: normal;
    }}

    /* 1920x1080 칠판 캔버스 컨테이너 */
    #canvas-container {{
      position: absolute;
      width: 1920px;
      height: 1080px;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) scale(1);
      transform-origin: center center;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.8);
      background: #141414;
    }}
    canvas {{
      display: block;
      width: 100%;
      height: 100%;
    }}
  </style>
  <script src="https://www.gstatic.com/firebasejs/10.9.0/firebase-app-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/10.9.0/firebase-database-compat.js"></script>
</head>
<body>
  <!-- 상단 컨트롤 & 상태바 -->
  <div id="nav-bar">
    <span id="conn-badge" class="badge"></span>
    <span id="conn-text" style="display: none;">연결됨</span>

    <!-- 칠판 네비게이션 -->
    <button class="nav-btn" id="btn-prev">◀</button>
    <select id="slide-select">
      <option value="slide_1">칠판 1</option>
    </select>
    <button class="nav-btn" id="btn-next">▶</button>

    <span style="color: rgba(255,255,255,0.25); margin: 0 2px;">|</span>

    <!-- 라이브 팔로우 모드 버튼 -->
    <button id="live-sync-btn" title="교수자가 보고 있는 화면으로 즉시 전환">
      <span>●</span> LIVE
    </button>
  </div>

  <div id="canvas-container">
    <canvas id="board-canvas" width="1920" height="1080"></canvas>
  </div>

  <script>
    const firebaseConfig = {json.dumps(fb_config)};
    const roomId = "{room_id}";

    const container = document.getElementById("canvas-container");
    const canvas = document.getElementById("board-canvas");
    const ctx = canvas.getContext("2d");

    const BOARD_WIDTH = 1920;
    const BOARD_HEIGHT = 1080;
    const FRAME_THICKNESS = 24;
    const WRITABLE_RECT = {{
      left: FRAME_THICKNESS,
      top: FRAME_THICKNESS,
      right: BOARD_WIDTH - FRAME_THICKNESS,
      bottom: BOARD_HEIGHT - FRAME_THICKNESS,
      width: BOARD_WIDTH - FRAME_THICKNESS * 2,
      height: BOARD_HEIGHT - FRAME_THICKNESS * 2
    }};

    // 상태 관리
    let currentHostSlideId = "slide_1"; // 교수자가 현재 보고 있는 슬라이드
    let viewerSlideId = "slide_1";       // 학생이 현재 보고 있는 슬라이드
    let isLiveSync = true;               // 교수자 화면 자동 팔로우 여부
    let availableSlideIds = ["slide_1"];
    let currentTheme = "chalkboard";
    let strokesMap = new Map();

    function resizeContainer() {{
      const vw = window.innerWidth || document.documentElement.clientWidth;
      const vh = window.innerHeight || document.documentElement.clientHeight;
      const scaleX = vw / BOARD_WIDTH;
      const scaleY = vh / BOARD_HEIGHT;
      const scale = Math.min(scaleX, scaleY) * 0.96;
      container.style.transform = `translate(-50%, -50%) scale(${{scale}})`;
    }}

    window.addEventListener("resize", resizeContainer);
    window.addEventListener("orientationchange", () => setTimeout(resizeContainer, 150));
    resizeContainer();

    function getThemeColors(theme) {{
      switch (theme) {{
        case "whiteboard":
          return {{ bg: "#F8FAFC", grid: "rgba(0, 0, 0, 0.07)" }};
        case "blackboard":
          return {{ bg: "#141414", grid: "rgba(255, 255, 255, 0.09)" }};
        default:
          return {{ bg: "#1E3D2F", grid: "rgba(255, 255, 255, 0.08)" }};
      }}
    }}

    function renderBoard() {{
      ctx.clearRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);

      // 원목 테두리
      ctx.fillStyle = "#5C3A21";
      ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
      const ftThird = FRAME_THICKNESS / 3;
      ctx.fillStyle = "#7A4E2D";
      ctx.fillRect(0, 0, BOARD_WIDTH, ftThird);
      ctx.fillRect(0, 0, ftThird, BOARD_HEIGHT);
      ctx.fillStyle = "#3D2514";
      ctx.fillRect(0, BOARD_HEIGHT - ftThird, BOARD_WIDTH, BOARD_HEIGHT);
      ctx.fillRect(BOARD_WIDTH - ftThird, 0, BOARD_WIDTH, BOARD_HEIGHT);

      // 칠판 배경
      const colors = getThemeColors(currentTheme);
      ctx.fillStyle = colors.bg;
      ctx.fillRect(WRITABLE_RECT.left, WRITABLE_RECT.top, WRITABLE_RECT.width, WRITABLE_RECT.height);

      // 모눈 격자
      ctx.save();
      ctx.beginPath();
      ctx.rect(WRITABLE_RECT.left, WRITABLE_RECT.top, WRITABLE_RECT.width, WRITABLE_RECT.height);
      ctx.clip();

      ctx.strokeStyle = colors.grid;
      ctx.lineWidth = 1;
      const gridSize = 40;
      for (let x = WRITABLE_RECT.left; x <= WRITABLE_RECT.right; x += gridSize) {{
        ctx.beginPath();
        ctx.moveTo(x, WRITABLE_RECT.top);
        ctx.lineTo(x, WRITABLE_RECT.bottom);
        ctx.stroke();
      }}
      for (let y = WRITABLE_RECT.top; y <= WRITABLE_RECT.bottom; y += gridSize) {{
        ctx.beginPath();
        ctx.moveTo(WRITABLE_RECT.left, y);
        ctx.lineTo(WRITABLE_RECT.right, y);
        ctx.stroke();
      }}

      // 판서 렌더링
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      strokesMap.forEach((stroke) => {{
        if (!stroke.points || stroke.points.length < 2) return;
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.width;
        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
        for (let i = 1; i < stroke.points.length; i++) {{
          ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
        }}
        ctx.stroke();
      }});

      ctx.restore();
    }}

    renderBoard();

    // UI 요소
    const connBadge = document.getElementById("conn-badge");
    const slideSelect = document.getElementById("slide-select");
    const btnPrev = document.getElementById("btn-prev");
    const btnNext = document.getElementById("btn-next");
    const liveSyncBtn = document.getElementById("live-sync-btn");

    function updateLiveButtonState() {{
      if (isLiveSync) {{
        liveSyncBtn.classList.remove("off");
        liveSyncBtn.innerHTML = "<span>●</span> LIVE";
      }} else {{
        liveSyncBtn.classList.add("off");
        liveSyncBtn.innerHTML = "<span>○</span> LIVE 동기화";
      }}
    }}

    function setViewerSlide(targetSlideId, isTriggeredByUser = false) {{
      if (isTriggeredByUser) {{
        // 학생이 수동으로 조작하면 LIVE 동기화 해제
        isLiveSync = (targetSlideId === currentHostSlideId);
        updateLiveButtonState();
      }}

      viewerSlideId = targetSlideId;
      slideSelect.value = targetSlideId;
      bindSlideListeners(viewerSlideId);
    }}

    // UI 이벤트 핸들러
    slideSelect.addEventListener("change", (e) => {{
      setViewerSlide(e.target.value, true);
    }});

    btnPrev.addEventListener("click", () => {{
      const idx = availableSlideIds.indexOf(viewerSlideId);
      if (idx > 0) {{
        setViewerSlide(availableSlideIds[idx - 1], true);
      }}
    }});

    btnNext.addEventListener("click", () => {{
      const idx = availableSlideIds.indexOf(viewerSlideId);
      if (idx < availableSlideIds.length - 1) {{
        setViewerSlide(availableSlideIds[idx + 1], true);
      }}
    }});

    liveSyncBtn.addEventListener("click", () => {{
      isLiveSync = true;
      updateLiveButtonState();
      setViewerSlide(currentHostSlideId, false);
    }});

    // Firebase 연동
    try {{
      if (!firebase.apps.length) {{
        firebase.initializeApp(firebaseConfig);
      }}
      const db = firebase.database();
      const roomRef = db.ref(`whiteboard_rooms/${{roomId}}`);

      db.ref(".info/connected").on("value", (snap) => {{
        if (snap.val() === true) {{
          connBadge.classList.remove("disconnected");
        }} else {{
          connBadge.classList.add("disconnected");
        }}
      }});

      // 1. 전체 슬라이드 목록 실시간 감지 (새 슬라이드 추가/삭제 반영)
      roomRef.child("slides").on("value", (snapshot) => {{
        if (!snapshot.exists()) return;
        const keys = Object.keys(snapshot.val());
        if (keys.length > 0) {{
          availableSlideIds = keys.sort((a, b) => {{
            const numA = parseInt(a.replace("slide_", "")) || 0;
            const numB = parseInt(b.replace("slide_", "")) || 0;
            return numA - numB;
          }});

          // 셀렉트 옵션 갱신
          slideSelect.innerHTML = "";
          availableSlideIds.forEach((sId) => {{
            const opt = document.createElement("option");
            opt.value = sId;
            opt.textContent = `칠판 ${{sId.replace("slide_", "")}}`;
            slideSelect.appendChild(opt);
          }});

          if (!availableSlideIds.includes(viewerSlideId)) {{
            viewerSlideId = availableSlideIds[0];
          }}
          slideSelect.value = viewerSlideId;
        }}
      }});

      // 2. 교수자의 현재 슬라이드 위치 감지
      roomRef.child("current_slide").on("value", (snapshot) => {{
        currentHostSlideId = snapshot.val() || "slide_1";
        if (isLiveSync) {{
          setViewerSlide(currentHostSlideId, false);
        }}
      }});

      let currentSlideStrokesRef = null;
      let currentSlideThemeRef = null;

      function bindSlideListeners(slideId) {{
        if (currentSlideStrokesRef) currentSlideStrokesRef.off();
        if (currentSlideThemeRef) currentSlideThemeRef.off();

        strokesMap.clear();
        renderBoard();

        // 선택된 슬라이드의 고유 테마 바인딩
        currentSlideThemeRef = roomRef.child(`slides/${{slideId}}/theme`);
        currentSlideThemeRef.on("value", (snap) => {{
          currentTheme = snap.val() || "chalkboard";
          renderBoard();
        }});

        // 선택된 슬라이드의 판서 데이터 바인딩
        currentSlideStrokesRef = roomRef.child(`slides/${{slideId}}/strokes`);
        currentSlideStrokesRef.on("child_added", (snap) => {{
          const strokeData = snap.val();
          if (strokeData) {{
            strokesMap.set(snap.key, strokeData);
            renderBoard();
          }}
        }});

        currentSlideStrokesRef.on("child_changed", (snap) => {{
          const strokeData = snap.val();
          if (strokeData) {{
            strokesMap.set(snap.key, strokeData);
            renderBoard();
          }}
        }});

        currentSlideStrokesRef.on("child_removed", (snap) => {{
          strokesMap.delete(snap.key);
          renderBoard();
        }});

        currentSlideStrokesRef.on("value", (snap) => {{
          if (!snap.exists()) {{
            strokesMap.clear();
            renderBoard();
          }}
        }});
      }}

    }} catch (err) {{
      console.error("Firebase Init Error:", err);
      connBadge.classList.add("disconnected");
    }}

    document.addEventListener("contextmenu", (e) => e.preventDefault());
  </script>
</body>
</html>
"""

components.html(viewer_html, height=1000, scrolling=False)