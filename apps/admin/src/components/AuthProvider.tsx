import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { contractJson, localLoginSchema, localSetupSchema, userSchema, type User } from "@eventdesk/contracts";
import { ApiError, apiContract, apiNoContent } from "@/lib/api";

interface AuthState {
  user: User | null;
  loading: boolean;
  login(username: string, password: string): Promise<void>;
  setup(username: string, password: string): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);
const USER_KEY = ["auth", "me"];

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const current = useQuery<User | null>({
    queryKey: USER_KEY,
    queryFn: async () => {
      try { return await apiContract("/auth/me", userSchema); }
      catch (error) { if (error instanceof ApiError && error.status === 401) return null; throw error; }
    },
    retry: false,
    staleTime: 30_000,
  });
  const value = useMemo<AuthState>(() => ({
    user: current.data ?? null,
    loading: current.isLoading,
    async login(username, password) {
      const user = await apiContract("/auth/login", userSchema, {
        method: "POST",
        body: contractJson(localLoginSchema, { username, password }),
      });
      client.setQueryData(USER_KEY, user);
    },
    async setup(username, password) {
      const user = await apiContract("/auth/setup", userSchema, {
        method: "POST",
        body: contractJson(localSetupSchema, { username, password }),
      });
      client.setQueryData(USER_KEY, user);
    },
    async logout() {
      await apiNoContent("/auth/logout", { method: "POST" });
      client.setQueryData(USER_KEY, null);
      await client.invalidateQueries({ queryKey: USER_KEY });
    },
  }), [current.data, current.isLoading, client]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider.");
  return value;
}
