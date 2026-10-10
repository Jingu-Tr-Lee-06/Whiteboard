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

# Streamlit 내비게이션, 여백, 헤더 제거 및 동적 뷰포트(100dvh) 강제 적용
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
    """Streamlit Secrets에서 Firebase 설정 로드 (하드코딩 제거)"""
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
    
    st.error("⚠️ Firebase 설정이 누락되었습니다. .streamlit/secrets.toml 파일을 확인해 주세요.")
    st.stop()

def get_prof_auth_code():
    """교수자 인증 비밀번호 로드"""
    if "auth" in st.secrets:
        return st.secrets["auth"].get("prof_code", "prof1234")
    return "prof1234"

# 1. 설정 로드
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

# 3. 소스 읽기
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

# 5. 설정 및 JS 스크립트 번들링
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

# 6. 컴포넌트 렌더링
components.html(html_content, scrolling=False)