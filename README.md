# 10분 대화 (시간 제한 1:1 채팅)

API 키 없이 Node.js + Socket.IO만 사용합니다. 서버 프로그램을 실행해야 동작합니다.

## 실행
```
npm install
npm start
```
- 같은 PC: http://localhost:3000 (일반 창 + 시크릿 창)
- 폰/다른 PC: 서버 터미널에 출력되는 http://192.168.x.x:3000
- 테스트용 짧은 시간: `DURATION_SEC=30 npm start` (PowerShell: `$env:DURATION_SEC=30; npm start`)

## HTTPS(6계층 TLS) 켜기
```
npm run cert   # openssl 필요 (Git for Windows에 포함)
npm start      # certs/key.pem, cert.pem 이 있으면 자동으로 https 실행
```
브라우저에 "안전하지 않음" 경고가 뜨면 고급 → 계속 진행을 누르세요(자체 서명 인증서).

## OSI 7계층 대응
| 계층 | 이 프로젝트 | 확인 방법 |
|---|---|---|
| 7 응용 | Socket.IO 이벤트(login, find, message, choice), 매칭/타이머 | 서버 로그, 화면 |
| 6 표현 | JSON + UTF-8, TLS(https/wss) | 서버 로그, Wireshark(TLS) |
| 5 세션 | 소켓 세션 ID, 전송 방식 | 서버 로그, 화면 하단 패널 |
| 4 전송 | TCP 포트 | 서버 로그, Wireshark |
| 3 네트워크 | 클라이언트/서버 IP | 서버 로그, Wireshark |
| 2 데이터 링크 | 서버 MAC 주소 | 서버 시작 로그, Wireshark |
| 1 물리 | Wi-Fi/랜선 (폰 접속 시 실제 통신) | 시연 |

## 배포
서버가 계속 켜져 있어야 하므로 GitHub Pages는 안 됩니다. Render 등에 이 저장소를 연결하고
Start Command에 `node server.js`, 포트는 `process.env.PORT`를 사용합니다(이미 적용됨).
클라우드에서는 TLS를 플랫폼이 처리하므로 certs는 필요 없습니다.
