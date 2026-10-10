import streamlit as st
import streamlit.components.v1 as components
import json

st.set_page_config(
    page_title="스마트 칠판 - 학생용 뷰어",
    page_icon="🖥️",
    layout="wide",
    initial_sidebar_state="collapsed",
)

# 모바일 및 데스크톱 공통: Streamlit 기본 여백 제거 및 iframe 100% 채움
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
    #status-bar {{
      position: absolute;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(30, 34, 42, 0.88);
      backdrop-filter: blur(8px);
      padding: 5px 14px;
      border-radius: 20px;
      border: 1px solid rgba(255, 255, 255, 0.15);
      font-size: 12px;
      color: #E0E0E0;
      display: flex;
      align-items: center;
      gap: 8px;
      z-index: 10;
      pointer-events: none;
      box-shadow: 0 4px 10px rgba(0,0,0,0.4);
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
    
    /* 1920x1080 규격 컨테이너 */
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
  <div id="status-bar">
    <span id="conn-badge" class="badge"></span>
    <span id="conn-text">연결 중...</span>
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

    // 동적 반응형 배율 계산 (폰 세로/가로 모드 및 PC 모니터 모두 대응)
    function resizeContainer() {{
      const vw = window.innerWidth || document.documentElement.clientWidth;
      const vh = window.innerHeight || document.documentElement.clientHeight;

      const scaleX = vw / BOARD_WIDTH;
      const scaleY = vh / BOARD_HEIGHT;

      // 상하/좌우 여백을 소폭(2~4%) 남겨 화면 모서리에 닿지 않도록 설정
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

    renderBoard();

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
          slideInfo.textContent = `${{slideNumber}}번 칠판`;
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
      connText.textContent = "Firebase 설정 오류";
      connBadge.classList.add("disconnected");
    }}

    document.addEventListener("contextmenu", (e) => e.preventDefault());
  </script>
</body>
</html>
"""

components.html(viewer_html, height=1000, scrolling=False)