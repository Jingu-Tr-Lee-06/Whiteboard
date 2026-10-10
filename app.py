import json
import os
import streamlit as st
import streamlit.components.v1 as components

# 페이지 기본 설정: 반응형 풀스크린 및 기본 UI 최소화
st.set_page_config(
    page_title="Smart Whiteboard",
    page_icon="✏️",
    layout="wide",
    initial_sidebar_state="collapsed"
)

# Streamlit 내비게이션, 마진, 헤더, 푸터 완전 제거 및 iframe 풀스크린 강제
st.markdown(
    """
    <style>
      #MainMenu {visibility: hidden;}
      header {visibility: hidden;}
      footer {visibility: hidden;}
      
      html, body, .stApp {
        margin: 0 !important;
        padding: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        height: 100dvh !important;
        overflow: hidden !important;
      }
      
      .stMainBlockContainer {
        padding: 0 !important;
        max-width: 100vw !important;
        height: 100vh !important;
        height: 100dvh !important;
        overflow: hidden !important;
      }
      
      /* 태블릿 모바일 브라우저 주소창 변화에도 스크롤바가 생기지 않는 절대 고정 iframe */
      iframe {
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        height: 100dvh !important;
        border: none !important;
        overflow: hidden !important;
      }
    </style>
    """,
    unsafe_allow_html=True
)

def get_firebase_config():
    """Streamlit Secrets 또는 기본값에서 Firebase 접속 정보 로드"""
    try:
        if "firebase" in st.secrets:
            return {
                "apiKey": st.secrets["firebase"].get("apiKey", ""),
                "authDomain": st.secrets["firebase"].get("authDomain", ""),
                "databaseURL": st.secrets["firebase"].get("databaseURL", ""),
                "projectId": st.secrets["firebase"].get("projectId", ""),
                "storageBucket": st.secrets["firebase"].get("storageBucket", ""),
                "messagingSenderId": st.secrets["firebase"].get("messagingSenderId", ""),
                "appId": st.secrets["firebase"].get("appId", "")
            }
    except Exception:
        pass
    
    # 기본 구성 (싱가포르 RTDB)
    return {
        "apiKey": "AIzaSyAjb82MqAqUoHObs6yy0TYx3zkBPuMRbtY",
        "authDomain": "whiteboard-2c462.firebaseapp.com",
        "databaseURL": "https://whiteboard-2c462-default-rtdb.asia-southeast1.firebasedatabase.app",
        "projectId": "whiteboard-2c462",
        "storageBucket": "whiteboard-2c462.firebasestorage.app",
        "messagingSenderId": "817225916919",
        "appId": "1:817225916919:web:311b431ab04e050a3e4ef2"
    }

def get_prof_auth_code():
    """교수자 인증 비밀번호 로드"""
    try:
        if "auth" in st.secrets:
            return st.secrets["auth"].get("prof_code", "prof1234")
    except Exception:
        pass
    return "prof1234"

# 1. 환경 설정 로드
fb_config = get_firebase_config()
prof_code = get_prof_auth_code()

# 2. 정적 소스 파일 경로 구성
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")

html_path = os.path.join(FRONTEND_DIR, "index.html")
css_path = os.path.join(FRONTEND_DIR, "style.css")
slide_manager_path = os.path.join(FRONTEND_DIR, "slide_manager.js")
tools_path = os.path.join(FRONTEND_DIR, "tools.js")
export_pdf_path = os.path.join(FRONTEND_DIR, "export_pdf.js")
firebase_sync_path = os.path.join(FRONTEND_DIR, "firebase_sync.js")
main_path = os.path.join(FRONTEND_DIR, "main.js")

# 3. 파일 내용 읽기
with open(html_path, "r", encoding="utf-8") as f:
    html_content = f.read()

with open(css_path, "r", encoding="utf-8") as f:
    css_content = f.read()

with open(slide_manager_path, "r", encoding="utf-8") as f:
    slide_manager_js = f.read()

with open(tools_path, "r", encoding="utf-8") as f:
    tools_js = f.read()

with open(export_pdf_path, "r", encoding="utf-8") as f:
    export_pdf_js = f.read()

with open(firebase_sync_path, "r", encoding="utf-8") as f:
    firebase_sync_js = f.read()

with open(main_path, "r", encoding="utf-8") as f:
    main_js = f.read()

# 4. CSS 인라인 치환
html_content = html_content.replace(
    '<link rel="stylesheet" href="style.css" />',
    f'<style>{css_content}</style>'
)

# 5. Firebase 환경 변수 및 모든 JS 스크립트 번들링
bundle_scripts = f"""
<script>
  window.FIREBASE_CONFIG = {json.dumps(fb_config)};
  window.PROF_AUTH_CODE = "{prof_code}";
</script>
<script>{slide_manager_js}</script>
<script>{tools_js}</script>
<script>{export_pdf_js}</script>
<script>{firebase_sync_js}</script>
<script>{main_js}</script>
"""

script_tags_to_replace = (
    '<script src="slide_manager.js"></script>\n'
    '  <script src="tools.js"></script>\n'
    '  <script src="export_pdf.js"></script>\n'
    '  <script src="firebase_sync.js"></script>\n'
    '  <script src="main.js"></script>'
)

if script_tags_to_replace in html_content:
    html_content = html_content.replace(script_tags_to_replace, bundle_scripts)
else:
    html_content = html_content.replace('</body>', f'{bundle_scripts}</body>')

# 6. 컴포넌트 렌더링 (scrolling 원천 차단)
components.html(html_content, scrolling=False)