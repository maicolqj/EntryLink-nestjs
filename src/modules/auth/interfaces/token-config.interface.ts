export interface TokenConfig {
  secret: string;
  expiresIn: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}
