'use strict';

const express = require('express');
const boardController = require('../controllers/board-controller');
const { requireAuth } = require('../middlewares/auth');

const router = express.Router();

// 두 라우트 모두 swagger security 미지정 = 전역 bearerAuth 적용. 라우트 단위로 부착한다.
// router.use(requireAuth) 전역 부착을 쓰지 않는다 — BE-06이 같은 라우터에
// /api/boards/:boardId/posts를 추가할 때 부착 지점이 암묵 상속되는 것을 막는다.
router.get('/', requireAuth, boardController.list);
router.get('/:boardId', requireAuth, boardController.detail);

module.exports = router;
