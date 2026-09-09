'use strict';

const express = require('express');
const { requireAuth } = require('../middlewares/auth');
const postController = require('../controllers/post-controller');

// /api/boards 하위에 board-routes.js와 겹쳐 마운트한다(BE-05 파일 무수정 목적).
// board-routes.js의 GET /:boardId는 1세그먼트만 매치하므로 /api/boards/1/posts와 충돌하지 않는다.
const boardPostRoutes = express.Router();
boardPostRoutes.get('/:boardId/posts', requireAuth, postController.list);
boardPostRoutes.post('/:boardId/posts', requireAuth, postController.create);

// /api/posts 하위
const postRoutes = express.Router();
postRoutes.get('/:postId', requireAuth, postController.detail);
postRoutes.patch('/:postId', requireAuth, postController.update);
postRoutes.delete('/:postId', requireAuth, postController.remove);

module.exports = { postRoutes, boardPostRoutes };
