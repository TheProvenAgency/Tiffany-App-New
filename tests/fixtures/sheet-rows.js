// Real n8n sheet-sync payload items, verbatim (not synthetic) -- shared
// between tests/sheet-json.test.js (pure normalizer logic) and
// tests/sheet-sync-webhook.test.js (the real route). Not itself a *.test.js
// file, so node --test never picks it up or runs it as its own suite.
const shamond = {
  Member_List: 'Yes', Col_2: '', NAME: 'Shamond Anderson',
  PACKAGE: '6-Month Credit Repair Package',
  TU: 'Round 6 Done', EQ: 'Round 6 Done', EX: 'Round 6 Done', Notes: '',
  RND_1_DATE: '04/04/2025', ROUND_1_CFPB_EMAIL: 'Shamond322@outlook.com', CFPB_PW_RND_1: 'Shamond$0425',
  RND_2_DATE: '07/11/2025', ROUND_2_CFPB_EMAIL: 'anderson_shamond03@outlook.com', CFPB_PW_RND_2: 'Credit24Credit24!',
  RND_3_DATE: '08/19/2025', ROUND_3_CFPB_EMAIL: 'shamond.anderson2025@outlook.com\r', CFPB_PW_RND_3: 'Credit24Credit24!\r',
  RND_4_DATE: '11/24/2025', ROUND_4_CFPB_EMAIL: 'shamond_anderson@outlook.com', CFPB_PW_RND_4: 'Credit24Credit24!\r',
  RND_5_DATE: '12/22 antonette', ROUND_5_CFPB_EMAIL: 'Shamond_Anderson44@outlook.com', CFPB_PW_RND_5: 'Credit24Credit24!\r',
  RND_6_DATE: '01/30/2026 Mber\r', ROUND_6_CFPB_EMAIL: 'ShamondAnderson22@outlook.com\r', CFPB_PW_RND_6: 'Credit24Credit24!\r',
  RND_7_DATE: '', ROUND_7_CFPB_EMAIL: '', CFPB_PW_RND_7: '',
  RND_8_DATE: '', ROUND_8_CFPB_EMAIL: '', CFPB_PW_RND_8: '',
  RND_9_DATE: '', ROUND_9_CFPB_EMAIL: '', CFPB_PW_RND_9: '',
  RND_10_DATE: '', ROUND_10_CFPB_EMAIL: '', CFPB_PW_RND_10: '',
  id: 50, createdAt: '2026-08-15T08:49:54.406Z', updatedAt: '2026-08-16T17:52:13.163Z'
};

const barbrielle = {
  Member_List: 'Yes', Col_2: '06/11', NAME: 'Barbrielle Harper',
  PACKAGE: 'Transunion and Equifax Expedited Removal',
  TU: 'Rnd 3 login', EQ: 'Rnd 3 login', EX: '-', Notes: '',
  RND_1_DATE: '04/05/2025', ROUND_1_CFPB_EMAIL: 'barbrielleray25@outlook.com', CFPB_PW_RND_1: '@Harper$0425$',
  RND_2_DATE: '08/23/2025', ROUND_2_CFPB_EMAIL: 'barbrielle.harper@outlook.com\r', CFPB_PW_RND_2: 'Credit24Credit24!',
  RND_3_DATE: '', ROUND_3_CFPB_EMAIL: '', CFPB_PW_RND_3: '',
  RND_4_DATE: '', ROUND_4_CFPB_EMAIL: '', CFPB_PW_RND_4: '',
  RND_5_DATE: '', ROUND_5_CFPB_EMAIL: '', CFPB_PW_RND_5: '',
  RND_6_DATE: '', ROUND_6_CFPB_EMAIL: '', CFPB_PW_RND_6: '',
  RND_7_DATE: '', ROUND_7_CFPB_EMAIL: '', CFPB_PW_RND_7: '',
  RND_8_DATE: '', ROUND_8_CFPB_EMAIL: '', CFPB_PW_RND_8: '',
  RND_9_DATE: '', ROUND_9_CFPB_EMAIL: '', CFPB_PW_RND_9: '',
  RND_10_DATE: '', ROUND_10_CFPB_EMAIL: '', CFPB_PW_RND_10: '',
  id: 51, createdAt: '2026-08-15T08:49:54.504Z', updatedAt: '2026-08-16T17:52:13.246Z'
};

const kaleel = {
  Member_List: 'Yes', Col_2: '', NAME: 'Kaleel Hines', PACKAGE: 'Transunion&Experian',
  TU: 'Resolved', EQ: '-', EX: 'Resolved', Notes: '',
  RND_1_DATE: '04/06/2025', ROUND_1_CFPB_EMAIL: 'kaleelhines25@outlook.com', CFPB_PW_RND_1: '@Kaleel$0425',
  RND_2_DATE: '07/15.2025', ROUND_2_CFPB_EMAIL: 'hines_kaleel95@outlook.com', CFPB_PW_RND_2: 'Credit24Credit24!',
  RND_3_DATE: '09/04/2025', ROUND_3_CFPB_EMAIL: 'kaleel.hines@outlook.com', CFPB_PW_RND_3: 'Credit24Credit24!',
  RND_4_DATE: '', ROUND_4_CFPB_EMAIL: '', CFPB_PW_RND_4: '',
  RND_5_DATE: '', ROUND_5_CFPB_EMAIL: '', CFPB_PW_RND_5: '',
  RND_6_DATE: '', ROUND_6_CFPB_EMAIL: '', CFPB_PW_RND_6: '',
  RND_7_DATE: '', ROUND_7_CFPB_EMAIL: '', CFPB_PW_RND_7: '',
  RND_8_DATE: '', ROUND_8_CFPB_EMAIL: '', CFPB_PW_RND_8: '',
  RND_9_DATE: '', ROUND_9_CFPB_EMAIL: '', CFPB_PW_RND_9: '',
  RND_10_DATE: '', ROUND_10_CFPB_EMAIL: '', CFPB_PW_RND_10: '',
  id: 53, createdAt: '2026-08-15T08:49:54.681Z', updatedAt: '2026-08-16T17:52:13.415Z'
};

module.exports = { shamond, barbrielle, kaleel };
