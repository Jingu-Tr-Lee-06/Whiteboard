"""
app.py - 스마트 칠판 판서 시스템 메인 진입점
Streamlit secrets.toml 보안 설정을 프론트엔드로 안전하게 주입하고 커스텀 판서 뷰포트를 호스팅합니다.
"""

import json
from pathlib import Path
import streamlit as st
import streamlit.components.v1 as components

# 1. Streamlit 페이지 메타데이터 및 전체 화면 레이아웃 구성
st.set_page_config(
    page_title="Smart Whiteboard",
    page_icon="✏️",
    layout="wide",
    initial_sidebar_state="collapsed",
)

# 2. 기본 Streamlit 상단 헤더, 패딩, 여백 및 툴바 완전 제거 (전체 화면 캔버스 보장)
FULLSCREEN_STYLE = """
<style>
    /* 기본 여백 및 패딩 제거 */
    html, body, [data-testid="stAppViewContainer"], [data-testid="stMain"] {
        padding: 0 !important;
        margin: 0 !important;
        overflow: hidden !important;
        height: 100vh !important;
        width: 100vw !important;
    }
    
    /* 상단 헤더 및 툴바, 하단 푸터 숨김 */
    header[data-testid="stHeader"] {
        display: none !important;
    }
    footer {
        display: none !important;
    }
    [data-testid="stToolbar"] {
        display: none !important;
    }
    [data-testid="stDecoration"] {
        display: none !important;
    }
    
    /* 블록 컨테이너 100% 확장 */
    .block-container {
        padding: 0 !important;
        margin: 0 !important;
        max-width: 100% !important;
        height: 100vh !important;
    }
    
    /* iframe 꽉 차게 설정 */
    iframe {
        border: none !important;
        width: 100vw !important;
        height: 100vh !important;
        display: block !important;
    }
</style>
"""
st.markdown(FULLSCREEN_STYLE, unsafe_allow_html=True)


def load_secrets_config() -> tuple[dict, dict]:
    """
    .streamlit/secrets.toml 파일에서 설정을 안전하게 파싱합니다.
    설정 파일이 없거나 키가 누락된 경우 기본 폴백 구조를 반환합니다.
    """
    firebase_config = {
        "apiKey": "",
        "authDomain": "",
        "databaseURL": "",
        "projectId": "",
        "storageBucket": "",
        "messagingSenderId": "",
        "appId": "",
    }
    auth_config = {"prof_code": "prof1234"}

    try:
        if "firebase" in st.secrets:
            firebase_config = dict(st.secrets["firebase"])
        if "auth" in st.secrets and "prof_code" in st.secrets["auth"]:
            auth_config["prof_code"] = str(st.secrets["auth"]["prof_code"])
    except Exception as exc:
        st.warning(f"secrets.toml 로드 중 경고: {exc}. 기본 설정으로 구동됩니다.")

    return firebase_config, auth_config


def build_integrated_html(frontend_dir: Path, fb_cfg: dict, auth_cfg: dict) -> str:
    """
    frontend 폴더 내의 HTML, CSS, JS 파일들을 단일 번들 HTML로 병합하고
    보안 설정 스크립트를 최상단에 주입합니다.
    """
    html_path = frontend_dir / "index.html"
    css_path = frontend_dir / "style.css"
    tools_js_path = frontend_dir / "tools.js"
    export_pdf_js_path = frontend_dir / "export_pdf.js"
    sync_js_path = frontend_dir / "firebase_sync.js"
    main_js_path = frontend_dir / "main.js"

    # 원본 파일 읽기
    html_content = html_path.read_text(encoding="utf-8")
    css_content = css_path.read_text(encoding="utf-8")
    tools_js = tools_js_path.read_text(encoding="utf-8")
    export_pdf_js = export_pdf_js_path.read_text(encoding="utf-8")
    sync_js = sync_js_path.read_text(encoding="utf-8")
    main_js = main_js_path.read_text(encoding="utf-8")

    # secrets.toml 데이터를 전역 주입하는 인젝션 스크립트 블록
    injection_script = f"""
    <script>
      window.__FIREBASE_CONFIG__ = {json.dumps(fb_cfg)};
      window.__AUTH_CONFIG__ = {json.dumps(auth_cfg)};
    </script>
    """

    # 외부 상대경로 링크 태그 및 스크립트 태그를 인라인 데이터로 치환
    bundled_html = html_content.replace(
        '<link rel="stylesheet" href="style.css" />',
        f"<style>\n{css_content}\n</style>",
    )

    # 헤드 태그 끝단에 보안 주입 스크립트 삽입
    bundled_html = bundled_html.replace(
        "</head>", f"{injection_script}\n</head>"
    )

    # 하단 모듈 스크립트 태그들을 실제 번들 스크립트 본문으로 교체
    scripts_bundle = f"""
    <script>
    {tools_js}
    </script>
    <script>
    {export_pdf_js}
    </script>
    <script>
    {sync_js}
    </script>
    <script>
    {main_js}
    </script>
    """

    bundled_html = bundled_html.replace(
        '<script src="tools.js"></script>', ""
    ).replace(
        '<script src="export_pdf.js"></script>', ""
    ).replace(
        '<script src="firebase_sync.js"></script>', ""
    ).replace(
        '<script src="main.js"></script>', scripts_bundle
    )

    return bundled_html


def main():
    root_dir = Path(__file__).resolve().parent
    frontend_dir = root_dir / "frontend"

    # 필수 리소스 검증
    if not frontend_dir.exists():
        st.error("frontend 디렉터리를 찾을 수 없습니다.")
        return

    # 설정 로드 및 HTML 번들 생성
    firebase_cfg, auth_cfg = load_secrets_config()
    final_html = build_integrated_html(frontend_dir, firebase_cfg, auth_cfg)

    # 뷰포트 전체 높이로 컴포넌트 렌더링
    components.html(final_html, height=1050, scrolling=False)


if __name__ == "__main__":
    main()