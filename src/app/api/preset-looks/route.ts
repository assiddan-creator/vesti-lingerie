import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import type { Audience, Category, PresetLook } from "../../../lib/preset-looks";

const VALID_AUDIENCES: Audience[] = ["women", "men"];
const VALID_CATEGORIES: Category[] = ["Recommended", "Lingerie", "Casual", "Event", "Streetwear"];
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".svg"];

function toFolderName(category: Category) {
  return category.toLowerCase().replaceAll(" ", "");
}

function toTitleFromFilename(filename: string) {
  const base = filename.replace(/\.[^.]+$/, "");
  return base
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const audience = url.searchParams.get("audience") as Audience | null;
  const category = url.searchParams.get("category") as Category | null;

  if (!audience || !VALID_AUDIENCES.includes(audience)) {
    return NextResponse.json(
      { success: false, error: { message: "Invalid or missing audience." } },
      { status: 400 },
    );
  }

  if (!category || !VALID_CATEGORIES.includes(category)) {
    return NextResponse.json(
      { success: false, error: { message: "Invalid or missing category." } },
      { status: 400 },
    );
  }

  try {
    const folder = path.join(
      process.cwd(),
      "public",
      "looks",
      audience,
      toFolderName(category),
    );

    let looks: PresetLook[] = [];

    if (fs.existsSync(folder)) {
      const entries = fs.readdirSync(folder, { withFileTypes: true });
      looks = entries
        .filter((e) => e.isFile())
        .filter((e) => IMAGE_EXTENSIONS.includes(path.extname(e.name).toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map<PresetLook>((e) => {
          const filename = e.name;
          const id = `${audience}-${toFolderName(category)}-${filename}`;
          const title = toTitleFromFilename(filename);
          const imageSrc = `/looks/${audience}/${toFolderName(category)}/${filename}`;
          return { id, title, imageSrc };
        });
    }

    return NextResponse.json({ success: true, looks }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: {
          message: "Failed to read preset looks.",
          details: error instanceof Error ? error.message : "Unknown error",
        },
      },
      { status: 500 },
    );
  }
}

