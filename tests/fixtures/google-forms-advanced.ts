type RawArray = unknown[];

const image = (sourceId: string, width: number, height: number, alignment: number | null = null) =>
  [sourceId, alignment, [width, height, 0]];

const option = (input: {
  label: string;
  other?: boolean;
  image?: RawArray;
  target?: number;
}) => [
  input.label,
  null,
  input.target ?? null,
  null,
  input.other ? 1 : 0,
  input.image ?? null,
];

const choices = (...labels: string[]) => labels.map((label) => option({ label }));

function ratingEntry(entryId: number, max: number, icon: number): RawArray {
  const entry: RawArray = [entryId, choices(...Array.from({ length: max }, (_, index) => String(index + 1))), 0];
  entry[16] = [icon];
  return entry;
}

function gridEntry(
  entryId: number,
  row: string,
  columns: string[],
  required: boolean,
  multiple: boolean,
): RawArray {
  const entry: RawArray = [entryId, choices(...columns), required ? 1 : 0, [row]];
  entry[11] = [multiple ? 1 : 0];
  return entry;
}

function dateEntry(entryId: number, includeTime: boolean, includeYear: boolean): RawArray {
  const entry: RawArray = [entryId, null, 0];
  entry[7] = [includeTime ? 1 : 0, includeYear ? 1 : 0];
  return entry;
}

function timeEntry(entryId: number, duration: boolean): RawArray {
  const entry: RawArray = [entryId, null, 0];
  entry[6] = [duration ? 1 : 0];
  return entry;
}

function section(
  itemId: number,
  title: string,
  description: string,
  navigation?: number,
): RawArray {
  const item: RawArray = [itemId, title, description, 8, null];
  if (navigation !== undefined) item[5] = navigation;
  return item;
}

export function advancedGoogleFormsFixtureHtml(): string {
  const optionImageOne = image("option-image-one", 260, 461);
  const optionImageTwo = image("option-image-two", 260, 461);
  const standaloneImage = image("standalone-image", 2252, 4000, 0);
  const embeddedImage = image("question-image", 740, 1314);

  const uniqueGrid: RawArray = [
    115,
    "객관식 그리드",
    null,
    7,
    [
      gridEntry(2151, "행 1", ["열 1", "열 2", "열 3"], true, false),
      gridEntry(2152, "행 2", ["열 1", "열 2", "열 3"], true, false),
      gridEntry(2153, "행 3", ["열 1", "열 2", "열 3"], true, false),
    ],
  ];
  uniqueGrid[8] = [[8, 205]];

  const questionWithImage: RawArray = [
    122,
    "질문 내 이미지",
    null,
    1,
    [[222, null, 0]],
  ];
  questionWithImage[9] = [embeddedImage];

  const rawItems: RawArray[] = [
    [
      101,
      "단답형, 필수, 숫자 1-120",
      "숫자를 입력하세요.",
      0,
      [[201, null, 1, null, [[1, 7, ["1", "120"], "1~120만 입력하세요."]]]],
    ],
    [
      102,
      "장문형, 필수, 최소 20자",
      "20자 이상 입력하세요.",
      1,
      [[202, null, 1, null, [[6, 203, ["20"], "20자 이상 입력하세요."]]]],
    ],
    [
      103,
      "객관식, 선택지 이미지",
      null,
      2,
      [[
        203,
        [
          option({ label: "옵션 1", image: optionImageOne }),
          option({ label: "옵션 2", image: optionImageTwo }),
          option({ label: "옵션 3" }),
          option({ label: "옵션 4" }),
        ],
        0,
      ]],
    ],
    [104, "제목/설명 블록", "응답이 없는 콘텐츠", 6, null],
    [105, "동영상", "YouTube 콘텐츠", 12, null, null, [null, 1, [320, 180, 0], "jNQXAC9IVRw"]],
    [
      106,
      "객관식, 기타",
      null,
      2,
      [[206, [...choices("옵션 1", "옵션 2", "옵션 3", "옵션 4"), option({ label: "", other: true })], 0]],
    ],
    [107, "체크박스", null, 4, [[207, choices("옵션 1", "옵션 2"), 0]]],
    [
      108,
      "체크박스, 필수, 최소 2개",
      null,
      4,
      [[208, choices("옵션 1", "옵션 2", "옵션 3"), 1, null, [[7, 200, ["2"], "2개 이상"]]]],
    ],
    [109, "드롭다운", null, 3, [[209, choices("옵션 1", "옵션 2"), 0]]],
    [110, "선형 배율 0-10", null, 5, [[210, choices(...Array.from({ length: 11 }, (_, index) => String(index))), 0, ["", ""]]]],
    [111, "선형 배율 1-5", null, 5, [[211, choices("1", "2", "3", "4", "5"), 0, ["낮음", "높음"]]]],
    [112, "별 등급", null, 18, [ratingEntry(212, 5, 1)]],
    [113, "하트 등급", null, 18, [ratingEntry(213, 10, 2)]],
    [114, "좋아요 등급", null, 18, [ratingEntry(214, 3, 3)]],
    uniqueGrid,
    [
      116,
      "객관식 그리드 선택",
      null,
      7,
      [
        gridEntry(2161, "행 1", ["열 1"], false, false),
        gridEntry(2162, "행 2", ["열 1"], false, false),
      ],
    ],
    [
      117,
      "체크박스 그리드",
      null,
      7,
      [
        gridEntry(2171, "행 1", ["열 1", "열 2"], true, true),
        gridEntry(2172, "행 2", ["열 1", "열 2"], true, true),
        gridEntry(2173, "행 3", ["열 1", "열 2"], true, true),
      ],
    ],
    [118, "날짜, 연도 미포함", null, 9, [dateEntry(218, false, false)]],
    [119, "날짜, 시간 포함", null, 9, [dateEntry(219, true, true)]],
    [120, "시간", null, 10, [timeEntry(220, false)]],
    [121, "기간", null, 10, [timeEntry(221, true)]],
    [123, "독립 이미지", null, 11, null, null, standaloneImage],
    questionWithImage,
    section(124, "분기 테스트", "분기 검증"),
    [
      125,
      "분기 선택",
      null,
      2,
      [[225, [option({ label: "A 경로", target: 126 }), option({ label: "B 경로", target: 128 })], 1]],
    ],
    section(126, "A 경로", "A 전용", -3),
    [127, "A 경로 단답", null, 0, [[227, null, 1]]],
    section(128, "B 경로", "B 전용"),
    [129, "B 경로 장문", null, 1, [[229, null, 1]]],
  ];

  const formData: RawArray = [];
  formData[0] = "advanced fixture description";
  formData[1] = rawItems;
  formData[8] = "Advanced Fixture Form";
  const payload: RawArray = [];
  payload[1] = formData;
  payload[3] = "Document title";

  return `<html lang="ko"><body>
    <form action="https://docs.google.com/forms/d/e/advanced/formResponse" method="POST">
      <img src="https://docs.google.com/forms-images-rt/option-one=w260" />
      <img src="https://docs.google.com/forms-images-rt/option-two=w260" />
      <img src="https://docs.google.com/forms-images-rt/standalone=w2252" alt="독립 이미지 대체 텍스트" />
      <img src="https://docs.google.com/forms-images-rt/question=w740" alt="문항 이미지 대체 텍스트" />
      <input type="hidden" name="fvv" value="1" />
      <input type="hidden" name="fbzx" value="fixture-seed" />
      <input type="hidden" name="pageHistory" value="0" />
      <input type="hidden" name="partialResponse" value="[null,null,&quot;fixture-seed&quot;]" />
    </form>
    <script>var FB_PUBLIC_LOAD_DATA_ = ${JSON.stringify(payload)};</script>
  </body></html>`;
}
