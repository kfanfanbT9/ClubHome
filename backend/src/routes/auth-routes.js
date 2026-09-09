'use strict';

const express = require('express');
const authController = require('../controllers/auth-controller');
const { requireAuth } = require('../middlewares/auth');

const router = express.Router();

// signup·login·refresh는 swagger security: [] — 인증 불필요.
router.post('/signup', authController.signup);
router.post('/login', authController.login);
router.post('/refresh', authController.refresh);
// logout만 인증이 필요하다(swagger security 미지정 = 전역 bearerAuth 적용).
router.post('/logout', requireAuth, authController.logout);

module.exports = router;
