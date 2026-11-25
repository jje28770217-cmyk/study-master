# 사회조사분석사 2급 Study Master

사회조사분석사 2급 필기시험 개인 학습 사이트입니다(비상업). 정적 웹사이트(HTML·CSS·JavaScript)이며 로그인·서버·DB·API가 없습니다.

## 데이터가 저장되는 곳 (외부 전송 없음)
| 데이터 | 저장 위치 |
|---|---|
| 학습 기록·설정 | 브라우저 LocalStorage |
| 업로드한 문제(기출복원·교재 등) | 브라우저 **IndexedDB** (공개 저장소에 올라가지 않음) |
| 내장 문제 300개 | `data/questions*.js` (직접 만든 자체 제작 예상문제, 공개) |

`index.html`의 CSP(`connect-src 'none'`)와 `vercel.json` 헤더가 외부 통신(fetch/XHR/폼)을 막습니다.

## 실행
`index.html`을 브라우저로 엽니다(빌드 없음).

## 문제 올리기
1. **PDF → JSON** : `tools/pdf2json` (아래 참고)
2. 사이트 **설정 → 문제 파일 업로드**에서 JSON·CSV 파일을 여러 개 한꺼번에 선택
3. 파일 형식: `subject(1~3), num, question, option1~4 또는 options[], answer(1~4), explanation` + 선택 `concept, kind, year, round, source, scope2027`
   - `kind`: `기출` / `기출복원` / `자체 제작 예상문제`. 기출·기출복원은 `year`·`source` 필수
   - **2022년 이전 기출**은 `scope2027: true`인 것만 바로 등록, 나머지는 "출제기준 선별 대기"에 보관되어 직접 골라 등록
   - 같은 연도·회차·과목·번호는 중복 등록되지 않음. CSV 양식은 설정 화면의 "CSV 양식 받기"
4. 등록하면 과목별 풀이·오답노트·이해도·일일 학습량·모의고사에 자동 반영됩니다. 문제 풀기·모의고사에서 "기출·기출복원 / 자체 제작" 출처를 골라 풀 수 있습니다.

## PDF 변환 프로그램 (`tools/pdf2json`)
```
cd tools/pdf2json
npm install
node convert.mjs "C:\내\PDF폴더" --out ../../private-data --csv --source "출처와 이용 조건"
```
- 폴더 안 PDF를 일괄 변환. 연도·회차는 파일 이름(예: `2025-1회.pdf`)에서 읽거나 `--year --round`로 지정
- 과목 구분: 100문항 30/30/40, 80문항 25/25/30 자동, 그 외 `--subject-ranges 1-20:1,21-40:2,...`
- 2022년 이전: `--scope-nums 1-5,12` 로 2027 출제기준 해당 번호 지정
- 인식 형식: `1.` 문제번호, ①~④ 보기, `정답 ③`/`해설:` 또는 끝의 `정답표`. 그림·표 문제와 스캔본(OCR 필요)은 `*.problems.json`에 기록
- **변환 결과는 원본과 꼭 대조**하세요. 결과 폴더(`private-data/`, `converted/`)와 `*.pdf`는 `.gitignore`로 제외됩니다.

## 백업·복원
설정 → "전체 백업"(학습 기록 + 업로드 문제) / "학습 기록만 백업" / "백업 파일에서 복원". 전체 백업 파일에는 문제 원문이 있으니 공개하지 마세요.

## 모의고사 규격
큐넷 출제기준(2027.1.1~2030.12.31): 80문제·120분·25/25/30. 과락 40%·합격 60점은 사용자가 알려 준 기준이므로 시험 공고로 확인하세요(`js/app.js`의 `EXAM`).

## 검사
`node tools/validate-questions.js` — 내장 문제 형식·중복·정답 분포 검사.

## 배포 (GitHub + Vercel, 공개)
공개 저장소에는 코드와 자체 제작 문제만 올라갑니다. 올리기 전 `git status`로 `private-data/`·PDF·백업 파일이 없는지 확인하세요.
1. 저장소 생성 후 push (커밋 이메일은 GitHub noreply 주소 권장)
2. vercel.com → Add New → Project → 저장소 선택 → Framework **Other**, 빌드·출력 설정 비움 → Deploy
