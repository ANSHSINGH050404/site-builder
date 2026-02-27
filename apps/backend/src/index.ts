import express from "express";
import morgan from "morgan";
import authRouter from "./routes/auth.route.js";

const app = express();
app.use(express.json());
app.use(morgan("dev"));

const port = 3000;

app.get("/", (req, res) => {
  res.send("Hello Likeable");
});

app.use("/", authRouter);

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
