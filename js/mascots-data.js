// ?? ??: mascots ??? PNG? ?? ?? ??? ???? ??
const MASCOT_ASSETS = [
  {
    "accept": [
      "가평군"
    ],
    "image": "mascots/가평군.png"
  },
  {
    "accept": [
      "강릉시"
    ],
    "image": "mascots/강릉시.png"
  },
  {
    "accept": [
      "강진군"
    ],
    "image": "mascots/강진군.png"
  },
  {
    "accept": [
      "거제시"
    ],
    "image": "mascots/거제시.png"
  },
  {
    "accept": [
      "거창군"
    ],
    "image": "mascots/거창군.png"
  },
  {
    "accept": [
      "경산시"
    ],
    "image": "mascots/경산시.png"
  },
  {
    "accept": [
      "경주시"
    ],
    "image": "mascots/경주시.png"
  },
  {
    "accept": [
      "계룡시"
    ],
    "image": "mascots/계룡시.png"
  },
  {
    "accept": [
      "고령군"
    ],
    "image": "mascots/고령군.png"
  },
  {
    "accept": [
      "고성군(강원)"
    ],
    "image": "mascots/고성군(강원).png"
  },
  {
    "accept": [
      "고성군(경남)"
    ],
    "image": "mascots/고성군(경남).png"
  },
  {
    "accept": [
      "고양시"
    ],
    "image": "mascots/고양시.png"
  },
  {
    "accept": [
      "고창군"
    ],
    "image": "mascots/고창군.png"
  },
  {
    "accept": [
      "고흥군"
    ],
    "image": "mascots/고흥군.png"
  },
  {
    "accept": [
      "곡성군"
    ],
    "image": "mascots/곡성군.png"
  },
  {
    "accept": [
      "공주시"
    ],
    "image": "mascots/공주시.png"
  },
  {
    "accept": [
      "과천시"
    ],
    "image": "mascots/과천시.png"
  },
  {
    "accept": [
      "광명시"
    ],
    "image": "mascots/광명시.png"
  },
  {
    "accept": [
      "광양시"
    ],
    "image": "mascots/광양시.png"
  },
  {
    "accept": [
      "광주광역시"
    ],
    "image": "mascots/광주광역시.png"
  },
  {
    "accept": [
      "광주시"
    ],
    "image": "mascots/광주시.png"
  },
  {
    "accept": [
      "괴산군"
    ],
    "image": "mascots/괴산군.png"
  },
  {
    "accept": [
      "구례군"
    ],
    "image": "mascots/구례군.png"
  },
  {
    "accept": [
      "구리시"
    ],
    "image": "mascots/구리시.png"
  },
  {
    "accept": [
      "구미시"
    ],
    "image": "mascots/구미시.png"
  },
  {
    "accept": [
      "군산시"
    ],
    "image": "mascots/군산시.png"
  },
  {
    "accept": [
      "군포시"
    ],
    "image": "mascots/군포시.png"
  },
  {
    "accept": [
      "금산군"
    ],
    "image": "mascots/금산군.png"
  },
  {
    "accept": [
      "김제시"
    ],
    "image": "mascots/김제시.png"
  },
  {
    "accept": [
      "김천시"
    ],
    "image": "mascots/김천시.png"
  },
  {
    "accept": [
      "김포시"
    ],
    "image": "mascots/김포시.png"
  },
  {
    "accept": [
      "김해시"
    ],
    "image": "mascots/김해시.png"
  },
  {
    "accept": [
      "나주시"
    ],
    "image": "mascots/나주시.png"
  },
  {
    "accept": [
      "남양주시"
    ],
    "image": "mascots/남양주시.png"
  },
  {
    "accept": [
      "남원시"
    ],
    "image": "mascots/남원시.png"
  },
  {
    "accept": [
      "남해군"
    ],
    "image": "mascots/남해군.png"
  },
  {
    "accept": [
      "논산시"
    ],
    "image": "mascots/논산시.png"
  },
  {
    "accept": [
      "단양군"
    ],
    "image": "mascots/단양군.png"
  },
  {
    "accept": [
      "담양군"
    ],
    "image": "mascots/담양군.png"
  },
  {
    "accept": [
      "당진시"
    ],
    "image": "mascots/당진시.png"
  },
  {
    "accept": [
      "대구광역시"
    ],
    "image": "mascots/대구광역시.png"
  },
  {
    "accept": [
      "대전광역시"
    ],
    "image": "mascots/대전광역시.png"
  },
  {
    "accept": [
      "동두천시"
    ],
    "image": "mascots/동두천시.png"
  },
  {
    "accept": [
      "동해시"
    ],
    "image": "mascots/동해시.png"
  },
  {
    "accept": [
      "목포시"
    ],
    "image": "mascots/목포시.png"
  },
  {
    "accept": [
      "무안군"
    ],
    "image": "mascots/무안군.png"
  },
  {
    "accept": [
      "무주군"
    ],
    "image": "mascots/무주군.png"
  },
  {
    "accept": [
      "문경시"
    ],
    "image": "mascots/문경시.png"
  },
  {
    "accept": [
      "밀양시"
    ],
    "image": "mascots/밀양시.png"
  },
  {
    "accept": [
      "보령시"
    ],
    "image": "mascots/보령시.png"
  },
  {
    "accept": [
      "보성군"
    ],
    "image": "mascots/보성군.png"
  },
  {
    "accept": [
      "보은군"
    ],
    "image": "mascots/보은군.png"
  },
  {
    "accept": [
      "봉화군"
    ],
    "image": "mascots/봉화군.png"
  },
  {
    "accept": [
      "부산광역시"
    ],
    "image": "mascots/부산광역시.png"
  },
  {
    "accept": [
      "부안군"
    ],
    "image": "mascots/부안군.png"
  },
  {
    "accept": [
      "부여군"
    ],
    "image": "mascots/부여군.png"
  },
  {
    "accept": [
      "부천시"
    ],
    "image": "mascots/부천시.png"
  },
  {
    "accept": [
      "사천시"
    ],
    "image": "mascots/사천시.png"
  },
  {
    "accept": [
      "산청군"
    ],
    "image": "mascots/산청군.png"
  },
  {
    "accept": [
      "삼척시"
    ],
    "image": "mascots/삼척시.png"
  },
  {
    "accept": [
      "상주시"
    ],
    "image": "mascots/상주시.png"
  },
  {
    "accept": [
      "서귀포시"
    ],
    "image": "mascots/서귀포시.png"
  },
  {
    "accept": [
      "서산시"
    ],
    "image": "mascots/서산시.png"
  },
  {
    "accept": [
      "서울특별시"
    ],
    "image": "mascots/서울특별시.png"
  },
  {
    "accept": [
      "서천군"
    ],
    "image": "mascots/서천군.png"
  },
  {
    "accept": [
      "성남시"
    ],
    "image": "mascots/성남시.png"
  },
  {
    "accept": [
      "성주군"
    ],
    "image": "mascots/성주군.png"
  },
  {
    "accept": [
      "세종특별자치시"
    ],
    "image": "mascots/세종특별자치시.png"
  },
  {
    "accept": [
      "속초시"
    ],
    "image": "mascots/속초시.png"
  },
  {
    "accept": [
      "수원시"
    ],
    "image": "mascots/수원시.png"
  },
  {
    "accept": [
      "순창군"
    ],
    "image": "mascots/순창군.png"
  },
  {
    "accept": [
      "순천시"
    ],
    "image": "mascots/순천시.png"
  },
  {
    "accept": [
      "시흥시"
    ],
    "image": "mascots/시흥시.png"
  },
  {
    "accept": [
      "신안군"
    ],
    "image": "mascots/신안군.png"
  },
  {
    "accept": [
      "아산시"
    ],
    "image": "mascots/아산시.png"
  },
  {
    "accept": [
      "안동시"
    ],
    "image": "mascots/안동시.png"
  },
  {
    "accept": [
      "안산시"
    ],
    "image": "mascots/안산시.png"
  },
  {
    "accept": [
      "안성시"
    ],
    "image": "mascots/안성시.png"
  },
  {
    "accept": [
      "안양시"
    ],
    "image": "mascots/안양시.png"
  },
  {
    "accept": [
      "양구군"
    ],
    "image": "mascots/양구군.png"
  },
  {
    "accept": [
      "양산시"
    ],
    "image": "mascots/양산시.png"
  },
  {
    "accept": [
      "양양군"
    ],
    "image": "mascots/양양군.png"
  },
  {
    "accept": [
      "양주시"
    ],
    "image": "mascots/양주시.png"
  },
  {
    "accept": [
      "양평군"
    ],
    "image": "mascots/양평군.png"
  },
  {
    "accept": [
      "여수시"
    ],
    "image": "mascots/여수시.png"
  },
  {
    "accept": [
      "여주시"
    ],
    "image": "mascots/여주시.png"
  },
  {
    "accept": [
      "연천군"
    ],
    "image": "mascots/연천군.png"
  },
  {
    "accept": [
      "영광군"
    ],
    "image": "mascots/영광군.png"
  },
  {
    "accept": [
      "영덕군"
    ],
    "image": "mascots/영덕군.png"
  },
  {
    "accept": [
      "영동군"
    ],
    "image": "mascots/영동군.png"
  },
  {
    "accept": [
      "영암군"
    ],
    "image": "mascots/영암군.png"
  },
  {
    "accept": [
      "영양군"
    ],
    "image": "mascots/영양군.png"
  },
  {
    "accept": [
      "영월군"
    ],
    "image": "mascots/영월군.png"
  },
  {
    "accept": [
      "영주시"
    ],
    "image": "mascots/영주시.png"
  },
  {
    "accept": [
      "영천시"
    ],
    "image": "mascots/영천시.png"
  },
  {
    "accept": [
      "예산군"
    ],
    "image": "mascots/예산군.png"
  },
  {
    "accept": [
      "예천군"
    ],
    "image": "mascots/예천군.png"
  },
  {
    "accept": [
      "오산시"
    ],
    "image": "mascots/오산시.png"
  },
  {
    "accept": [
      "옥천군"
    ],
    "image": "mascots/옥천군.png"
  },
  {
    "accept": [
      "완도군"
    ],
    "image": "mascots/완도군.png"
  },
  {
    "accept": [
      "완주군"
    ],
    "image": "mascots/완주군.png"
  },
  {
    "accept": [
      "용인시"
    ],
    "image": "mascots/용인시.png"
  },
  {
    "accept": [
      "울릉군"
    ],
    "image": "mascots/울릉군.png"
  },
  {
    "accept": [
      "울산광역시"
    ],
    "image": "mascots/울산광역시.png"
  },
  {
    "accept": [
      "울진군"
    ],
    "image": "mascots/울진군.png"
  },
  {
    "accept": [
      "원주시"
    ],
    "image": "mascots/원주시.png"
  },
  {
    "accept": [
      "음성군"
    ],
    "image": "mascots/음성군.png"
  },
  {
    "accept": [
      "의령군"
    ],
    "image": "mascots/의령군.png"
  },
  {
    "accept": [
      "의성군"
    ],
    "image": "mascots/의성군.png"
  },
  {
    "accept": [
      "의왕시"
    ],
    "image": "mascots/의왕시.png"
  },
  {
    "accept": [
      "의정부시"
    ],
    "image": "mascots/의정부시.png"
  },
  {
    "accept": [
      "이천시"
    ],
    "image": "mascots/이천시.png"
  },
  {
    "accept": [
      "익산시"
    ],
    "image": "mascots/익산시.png"
  },
  {
    "accept": [
      "인제군"
    ],
    "image": "mascots/인제군.png"
  },
  {
    "accept": [
      "인천광역시"
    ],
    "image": "mascots/인천광역시.png"
  },
  {
    "accept": [
      "임실군"
    ],
    "image": "mascots/임실군.png"
  },
  {
    "accept": [
      "장성군"
    ],
    "image": "mascots/장성군.png"
  },
  {
    "accept": [
      "장수군"
    ],
    "image": "mascots/장수군.png"
  },
  {
    "accept": [
      "장흥군"
    ],
    "image": "mascots/장흥군.png"
  },
  {
    "accept": [
      "전주시"
    ],
    "image": "mascots/전주시.png"
  },
  {
    "accept": [
      "정선군"
    ],
    "image": "mascots/정선군.png"
  },
  {
    "accept": [
      "정읍시"
    ],
    "image": "mascots/정읍시.png"
  },
  {
    "accept": [
      "제주시"
    ],
    "image": "mascots/제주시.png"
  },
  {
    "accept": [
      "제천시"
    ],
    "image": "mascots/제천시.png"
  },
  {
    "accept": [
      "증평군"
    ],
    "image": "mascots/증평군.png"
  },
  {
    "accept": [
      "진도군"
    ],
    "image": "mascots/진도군.png"
  },
  {
    "accept": [
      "진안군"
    ],
    "image": "mascots/진안군.png"
  },
  {
    "accept": [
      "진주시"
    ],
    "image": "mascots/진주시.png"
  },
  {
    "accept": [
      "진천군"
    ],
    "image": "mascots/진천군.png"
  },
  {
    "accept": [
      "창녕군"
    ],
    "image": "mascots/창녕군.png"
  },
  {
    "accept": [
      "창원시"
    ],
    "image": "mascots/창원시.png"
  },
  {
    "accept": [
      "천안시"
    ],
    "image": "mascots/천안시.png"
  },
  {
    "accept": [
      "철원군"
    ],
    "image": "mascots/철원군.png"
  },
  {
    "accept": [
      "청도군"
    ],
    "image": "mascots/청도군.png"
  },
  {
    "accept": [
      "청송군"
    ],
    "image": "mascots/청송군.png"
  },
  {
    "accept": [
      "청양군"
    ],
    "image": "mascots/청양군.png"
  },
  {
    "accept": [
      "청주시"
    ],
    "image": "mascots/청주시.png"
  },
  {
    "accept": [
      "춘천시"
    ],
    "image": "mascots/춘천시.png"
  },
  {
    "accept": [
      "충주시"
    ],
    "image": "mascots/충주시.png"
  },
  {
    "accept": [
      "칠곡군"
    ],
    "image": "mascots/칠곡군.png"
  },
  {
    "accept": [
      "태백시"
    ],
    "image": "mascots/태백시.png"
  },
  {
    "accept": [
      "태안군"
    ],
    "image": "mascots/태안군.png"
  },
  {
    "accept": [
      "통영시"
    ],
    "image": "mascots/통영시.png"
  },
  {
    "accept": [
      "파주시"
    ],
    "image": "mascots/파주시.png"
  },
  {
    "accept": [
      "평창군"
    ],
    "image": "mascots/평창군.png"
  },
  {
    "accept": [
      "평택시"
    ],
    "image": "mascots/평택시.png"
  },
  {
    "accept": [
      "포천시"
    ],
    "image": "mascots/포천시.png"
  },
  {
    "accept": [
      "포항시"
    ],
    "image": "mascots/포항시.png"
  },
  {
    "accept": [
      "하남시"
    ],
    "image": "mascots/하남시.png"
  },
  {
    "accept": [
      "하동군"
    ],
    "image": "mascots/하동군.png"
  },
  {
    "accept": [
      "함안군"
    ],
    "image": "mascots/함안군.png"
  },
  {
    "accept": [
      "함양군"
    ],
    "image": "mascots/함양군.png"
  },
  {
    "accept": [
      "함평군"
    ],
    "image": "mascots/함평군.png"
  },
  {
    "accept": [
      "합천군"
    ],
    "image": "mascots/합천군.png"
  },
  {
    "accept": [
      "해남군"
    ],
    "image": "mascots/해남군.png"
  },
  {
    "accept": [
      "홍성군"
    ],
    "image": "mascots/홍성군.png"
  },
  {
    "accept": [
      "홍천군"
    ],
    "image": "mascots/홍천군.png"
  },
  {
    "accept": [
      "화성시"
    ],
    "image": "mascots/화성시.png"
  },
  {
    "accept": [
      "화순군"
    ],
    "image": "mascots/화순군.png"
  },
  {
    "accept": [
      "화천군"
    ],
    "image": "mascots/화천군.png"
  },
  {
    "accept": [
      "횡성군"
    ],
    "image": "mascots/횡성군.png"
  }
];
