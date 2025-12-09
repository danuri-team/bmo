import dayjs from "dayjs";
import "dayjs/locale/ko.js";
import timezone from "dayjs/plugin/timezone.js";
import utc from "dayjs/plugin/utc.js";
import dedent from "dedent";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.locale("ko");

export function getDailyReportPrompt(): string {
  const today = dayjs().tz("Asia/Seoul");
  const yesterday = today.subtract(1, "day");

  return dedent`
    감자네컷 일일 리포트를 작성해주세요.

    **보고 날짜**: ${yesterday.format("YYYY년 MM월 DD일 (dddd)")}
    **생성 시간**: ${today.format("YYYY년 MM월 DD일 HH시 mm분")}

    다음 지표들을 조회하고 Discord 형식으로 보기 좋게 정리해주세요:

    # 📊 핵심 지표

    ## 사용자
    - 전체 사용자 수 (누적)
    - 신규 가입자 (어제)
    - DAU (어제)

    ## 제작
    - 생성 시작된 프레임 수 (어제, photo_cut_temps 기준)
    - 완성된 프레임 수 (어제, photos 기준)
    - 완성률 (완성/시작 * 100)

    ## 미디어
    - 업로드된 이미지 수 (어제, photo_cuts 기준)

    ## 공유
    - 다운로드 수 (어제, frames.download_count 증가분)
    - 좋아요 수 (어제, frame_likes 기준)

    # 📈 트렌드 분석

    ## 최근 7일 DAU 추이
    - 날짜별 DAU를 line 차트로 생성
    - 전주 대비 증감률 계산

    ## 인기 프레임 TOP 5
    - 어제 가장 많이 사용된 프레임
    - 제목, 카테고리, 사용 횟수 표시

    # 🎨 크리에이터

    - 어제 제출된 프레임 수 (status = 'PENDING')
    - 어제 승인된 프레임 수 (approved_at)

    # 💡 인사이트

    - 주목할 만한 변화나 이상치
    - 간단한 해석 및 제안

    ---

    **형식 요구사항**:
    1. Discord 임베드 형식으로 작성 (마크다운 활용)
    2. 이모지를 적절히 사용하여 가독성 향상
    3. 숫자는 천 단위 구분 (1,234)
    4. 증감률은 ▲/▼ 기호 사용
    5. 차트는 create_chart 도구 사용
    6. 전체 내용이 2000자를 넘지 않도록 간결하게

    필요한 모든 쿼리를 실행하고 차트를 생성한 후, 최종 리포트를 작성해주세요.
  `;
}
