import type { MeResponse } from "../me";

export const meFixture: MeResponse = {
  user: {
    id: "0192f3c0-0000-7000-8000-000000000001",
    name: "Noor de Vries",
    email: "noor@example.test",
    phone: null,
  },
};

export const meWithoutNameFixture: MeResponse = {
  user: { ...meFixture.user, name: "" },
};
