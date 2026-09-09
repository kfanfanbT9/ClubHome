'use strict';

const express = require('express');
const memberController = require('../controllers/member-controller');
const { requireAuth } = require('../middlewares/auth');

const router = express.Router();

// 두 라우트 모두 swagger security 미지정 = 전역 bearerAuth 적용. 라우트 단위로 부착한다.
router.get('/me', requireAuth, memberController.getMe);
router.patch('/me', requireAuth, memberController.updateMe);

module.exports = router;
