import express from "express";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import authRouter from "./routes/auth.route";
import projectRouter from "./routes/project_route";
import cors from "cors"


const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(morgan("dev"));
app.use(cors())

const port = 3000;





app.get("/health", (req, res) => {
  res.send("Hello Likeable");
});



console.log("Mounting routes...");
app.use("/auth", authRouter);
app.use("/projects", projectRouter);
console.log("Routes mounted.");

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
