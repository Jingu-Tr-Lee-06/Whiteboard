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
        .block-container {
            padding: 0 !important;
            max-width: 100% !important;
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

fb_config = {
    "apiKey": st.secrets.get("firebase", {}).get("api_key", ""),
    "authDomain": st.secrets.get("firebase", {}).get("auth_domain", ""),
    "databaseURL": st.secrets.get("firebase", {}).get("database_url", ""),
    "projectId": st.secrets.get("firebase", {}).get("project_id", ""),
    "storageBucket": st.secrets.get("firebase", {}).get("storage_bucket", ""),
    "messagingSenderId": st.secrets.get("firebase", {}).get("messaging_sender_id", ""),
    "appId": st.secrets.get("firebase", {}).get("app_id", ""),
}
room_id = st.secrets.get("whiteboard", {}).get("room_id", "default_room")

viewer_html = f"""
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
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
    #status-bar {{
      position: absolute;
      top: 14px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(30, 34, 42, 0.85);
      backdrop-filter: blur(8px);
      padding: 6px 16px;
      border-radius: 20px;
      border: 1px solid rgba(255, 255, 255, 0.15);
      font-size: 13px;
      color: #E0E0E0;
      display: flex;
      align-items: center;
      gap: 12px;
      z-index: 10;
      pointer-events: none;
    }}
    .badge {{
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background-color: #4CAF50;
      box-shadow: 0 0 8px #4CAF50;
    }}
    .badge.disconnected {{
      background-color: #F44336;
      box-shadow: 0 0 8px #F44336;
    }}
    #canvas-container {{
      position: relative;
      width: 1920px;
      height: 1080px;
      transform-origin: center center;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.7);
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
  <div id="status-bar">
    <span id="conn-badge" class="badge"></span>
    <span id="conn-text">연결 대기 중...</span>
    <span style="color: rgba(255,255,255,0.3)">|</span>
    <span id="slide-info">칠판 초기화 중</span>
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

    let currentSlideId = "slide_1";
    let currentTheme = "chalkboard";
    let strokesMap = new Map();

    function resizeContainer() {{
      const windowWidth = window.innerWidth || document.documentElement.clientWidth;
      const windowHeight = window.innerHeight || document.documentElement.clientHeight;
      const scaleX = windowWidth / BOARD_WIDTH;
      const scaleY = windowHeight / BOARD_HEIGHT;
      const scale = Math.min(scaleX, scaleY) * 0.92;
      container.style.transform = `scale(${{scale}})`;
    }}
    window.addEventListener("resize", resizeContainer);
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

      // 테두리
      ctx.fillStyle = "#5C3A21";
      ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
      const ftThird = FRAME_THICKNESS / 3;
      ctx.fillStyle = "#7A4E2D";
      ctx.fillRect(0, 0, BOARD_WIDTH, ftThird);
      ctx.fillRect(0, 0, ftThird, BOARD_HEIGHT);
      ctx.fillStyle = "#3D2514";
      ctx.fillRect(0, BOARD_HEIGHT - ftThird, BOARD_WIDTH, BOARD_HEIGHT);
      ctx.fillRect(BOARD_WIDTH - ftThird, 0, BOARD_WIDTH, BOARD_HEIGHT);

      // 배경
      const colors = getThemeColors(currentTheme);
      ctx.fillStyle = colors.bg;
      ctx.fillRect(WRITABLE_RECT.left, WRITABLE_RECT.top, WRITABLE_RECT.width, WRITABLE_RECT.height);

      // 격자
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

      // 판서
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

    // 즉시 기본 칠판 렌더링 (서버 연결 전이라도 칠판이 먼저 보임)
    renderBoard();

    // Firebase 초기화 및 리스너 등록
    const connBadge = document.getElementById("conn-badge");
    const connText = document.getElementById("conn-text");
    const slideInfo = document.getElementById("slide-info");

    try {{
      if (!firebase.apps.length) {{
        firebase.initializeApp(firebaseConfig);
      }}
      const db = firebase.database();
      const roomRef = db.ref(`whiteboard_rooms/${{roomId}}`);

      db.ref(".info/connected").on("value", (snap) => {{
        if (snap.val() === true) {{
          connBadge.classList.remove("disconnected");
          connText.textContent = "교수자 칠판 연결됨";
        }} else {{
          connBadge.classList.add("disconnected");
          connText.textContent = "연결 대기 중...";
        }}
      }});

      let currentSlideStrokesRef = null;
      let currentSlideThemeRef = null;

      roomRef.child("current_slide").on("value", (snapshot) => {{
        const newSlideId = snapshot.val() || "slide_1";
        if (newSlideId !== currentSlideId || currentSlideStrokesRef === null) {{
          currentSlideId = newSlideId;
          const slideNumber = currentSlideId.replace("slide_", "");
          slideInfo.textContent = `${{slideNumber}}번 칠판 시청 중`;
          bindSlideListeners(currentSlideId);
        }}
      }});

      function bindSlideListeners(slideId) {{
        if (currentSlideStrokesRef) currentSlideStrokesRef.off();
        if (currentSlideThemeRef) currentSlideThemeRef.off();

        strokesMap.clear();
        renderBoard();

        currentSlideThemeRef = roomRef.child(`slides/${{slideId}}/theme`);
        currentSlideThemeRef.on("value", (snap) => {{
          currentTheme = snap.val() || "chalkboard";
          renderBoard();
        }});

        currentSlideStrokesRef = roomRef.child(`slides/${{slideId}}/strokes`);
        currentSlideStrokesRef.on("child_added", (snap) => {{
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
      connText.textContent = "Firebase 설정 오류";
      connBadge.classList.add("disconnected");
    }}

    document.addEventListener("contextmenu", (e) => e.preventDefault());
  </script>
</body>
</html>
"""

components.html(viewer_html, height=880, scrolling=False)