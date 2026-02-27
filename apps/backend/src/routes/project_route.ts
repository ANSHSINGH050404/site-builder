import { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware.js";
import {
  createProject,
  getProjects,
  getProjectById,
  createProjectConversationChatMessage,
} from "../controllers/project.controller.js";

const router: Router = Router();

router.use(authenticate);

router.post("/", createProject);
router.get("/", getProjects);
router.get("/:id", getProjectById);
router.post("/:projectId/conversations", createProjectConversationChatMessage);
export default router;
