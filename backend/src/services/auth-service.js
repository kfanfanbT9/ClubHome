'use strict';

const { AppError } = require('../middlewares/errorHandler');
const { hashPassword, verifyPassword } = require('../utils/password');
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const memberRepository = require('../repositories/member-repository');
const memberGradeRepository = require('../repositories/member-grade-repository');

/**
 * 회원가입. 기본 등급(최저 grade_level)을 자동 부여하고 비밀번호를 해시로 저장한다.
 * 이메일 중복 판정은 선행 SELECT 없이 insertMember의 ON CONFLICT 결과(null)로만 한다.
 */
async function signup({ name, email, password, phone }) {
  const memberGradeId = await memberGradeRepository.findLowestGradeId();
  if (memberGradeId === null) {
    throw new Error('기본 회원등급이 존재하지 않습니다.');
  }

  const passwordHash = await hashPassword(password);
  const id = await memberRepository.insertMember({ email, passwordHash, name, phone, memberGradeId });
  if (id === null) {
    throw new AppError(409, 'EMAIL_DUPLICATE', '이미 사용 중인 이메일입니다.');
  }

  return memberRepository.findMemberById(id);
}

/**
 * 로그인. 비밀번호 검증을 계정상태 검사보다 먼저 수행한다(계정 열거 방지).
 * withdrawn 계정만 차단하고 dormant는 통과시킨다.
 */
async function login({ email, password }) {
  const auth = await memberRepository.findAuthByEmail(email);
  if (auth === null) {
    throw new AppError(401, 'UNAUTHORIZED', '이메일 또는 비밀번호가 일치하지 않습니다.');
  }

  const ok = await verifyPassword(password, auth.passwordHash);
  if (!ok) {
    throw new AppError(401, 'UNAUTHORIZED', '이메일 또는 비밀번호가 일치하지 않습니다.');
  }

  if (auth.member.accountStatus === 'withdrawn') {
    throw new AppError(403, 'ACCOUNT_WITHDRAWN', '탈퇴한 계정입니다.');
  }

  const accessToken = signAccessToken({
    id: auth.member.id,
    gradeLevel: auth.member.memberGrade.gradeLevel,
    isAdmin: auth.member.memberGrade.isAdmin,
  });
  const refreshToken = signRefreshToken({ id: auth.member.id });

  return { accessToken, refreshToken, member: auth.member };
}

/**
 * Access Token 재발급. 등급은 항상 최신 상태를 반영하기 위해 DB에서 재조회한다.
 * 회원 부재·탈퇴는 403이 아니라 401로 통일한다(swagger가 401만 정의).
 */
async function refreshAccessToken(refreshToken) {
  const payload = verifyRefreshToken(refreshToken);

  const member = await memberRepository.findMemberById(payload.memberId);
  if (!member || member.accountStatus === 'withdrawn') {
    throw new AppError(401, 'UNAUTHORIZED', '유효하지 않은 토큰입니다.');
  }

  const accessToken = signAccessToken({
    id: member.id,
    gradeLevel: member.memberGrade.gradeLevel,
    isAdmin: member.memberGrade.isAdmin,
  });

  return { accessToken };
}

module.exports = { signup, login, refreshAccessToken };
