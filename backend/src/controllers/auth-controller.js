'use strict';

const { AppError } = require('../middlewares/errorHandler');
const authService = require('../services/auth-service');
const { requireString } = require('../middlewares/validate');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 이메일 정규화. members.email UNIQUE는 대소문자를 구분하므로 가입·로그인이
 * 반드시 같은 규칙을 써야 한다. 정규화 규칙이 갈라지지 않도록 이 함수만 사용한다.
 */
function normalizeEmail(value) {
  return value.trim().toLowerCase();
}

/** 이메일 필수값 검증(가입용). 정규화된 문자열을 반환한다. 위반 시 400. */
function requireEmail(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AppError(400, 'BAD_REQUEST', '이메일을 입력해 주세요.');
  }
  const normalized = normalizeEmail(value);
  if (normalized.length > 255 || !EMAIL_PATTERN.test(normalized)) {
    throw new AppError(400, 'BAD_REQUEST', '이메일 형식이 올바르지 않습니다.');
  }
  return normalized;
}

/** 비밀번호 필수값 검증(가입용). trim하지 않는다. 위반 시 400. */
function requirePassword(value) {
  if (typeof value !== 'string') {
    throw new AppError(400, 'BAD_REQUEST', '비밀번호를 입력해 주세요.');
  }
  if (value.length < 8) {
    throw new AppError(400, 'BAD_REQUEST', '비밀번호는 8자 이상이어야 합니다.');
  }
  return value;
}

/** POST /api/auth/signup */
async function signup(req, res) {
  const body = req.body || {};

  const name = requireString(body.name, '이름', { maxLength: 50 });
  const email = requireEmail(body.email);
  const password = requirePassword(body.password);
  const phone = requireString(body.phone, '연락처', { maxLength: 20 });

  const member = await authService.signup({ name, email, password, phone });
  res.status(201).json(member);
}

/** POST /api/auth/login */
async function login(req, res) {
  const body = req.body || {};

  if (typeof body.email !== 'string' || body.email.trim().length === 0) {
    throw new AppError(401, 'UNAUTHORIZED', '이메일 또는 비밀번호가 일치하지 않습니다.');
  }
  if (typeof body.password !== 'string' || body.password.length === 0) {
    throw new AppError(401, 'UNAUTHORIZED', '이메일 또는 비밀번호가 일치하지 않습니다.');
  }
  // 가입과 동일한 정규화를 거쳐야 대문자 이메일 사용자가 로그인할 수 있다.
  const email = normalizeEmail(body.email);

  const result = await authService.login({ email, password: body.password });
  res.status(200).json(result);
}

/** POST /api/auth/refresh */
async function refresh(req, res) {
  const body = req.body || {};

  if (typeof body.refreshToken !== 'string' || body.refreshToken.length === 0) {
    throw new AppError(401, 'UNAUTHORIZED', '유효하지 않은 토큰입니다.');
  }

  const result = await authService.refreshAccessToken(body.refreshToken);
  res.status(200).json(result);
}

/** POST /api/auth/logout — 서버 측 토큰 저장소가 없으므로 인증 확인만 하고 204를 반환한다. */
function logout(req, res) {
  res.status(204).end();
}

module.exports = { signup, login, refresh, logout };
