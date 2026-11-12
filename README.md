# 야마가타우리교회 스튜디오

재일대한기독교회 야마가타우리교회의 예배 방송용 프로그램입니다. 맥과 윈도우에서 사용할 수 있습니다.

| 화면 | 하는 일 |
|------|---------|
| 배경 영상 | 끊김 없이 반복되는 예배 배경 영상을 만들어 MP4 로 저장 |
| 성경 자막 | 성경 구절을 디자인해 크로마키(초록 배경)로 내보내거나 카메라 위에 합성 |
| 동시통역 | 한국어 ⇄ 일본어 음성 인식 → 번역 자막 + 음성 (Chrome 에서 열림) |
| 방송 | 장면·소스 전환, 소리 믹서, 녹화, 유튜브(RTMP) 실시간 송출 |

## 내려받기

[Releases](../../releases) 에서 내 컴퓨터에 맞는 파일을 받습니다.

- `…-mac-arm64.zip` — 애플 칩(M1 이후) 맥
- `…-mac-intel.zip` — 인텔 맥
- `…-windows-x64.zip` — 윈도우 10/11 (64비트)

정식 서명이 없는 프로그램이라 처음 실행할 때 경고가 나옵니다. 여는 방법은 압축 안의 `읽어보기.txt` 에 있습니다.

함께 필요한 것: Google Chrome(동시통역), ffmpeg(유튜브 송출 · 녹화 MP4 정리 — 맥 `brew install ffmpeg`, 윈도우 `winget install ffmpeg`).

## 폴더

- `studio/` — 화면 원본 (HTML/JS). 브라우저로 바로 열어 볼 수도 있습니다.
- `studio-app/` — 프로그램 껍데기 (Electron). 녹화 저장 · 송출 · 통역 자막 전달을 맡습니다.

## 직접 만들기

```bash
cd studio-app
npm install
npm run build:all     # dist/ 에 맥(arm64, x64) · 윈도우(x64) 프로그램이 만들어집니다
```

`studio/mp4-muxer.min.js` 는 [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) (MIT) 입니다.
