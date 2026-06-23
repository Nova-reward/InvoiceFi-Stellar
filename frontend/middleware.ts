import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtDecode } from 'jwt-decode';

interface CustomJwtPayload {
  role?: 'farmer' | 'investor';
}

export function middleware(request: NextRequest) {
  const token = request.cookies.get('token')?.value;

  // Protect dashboard routes
  if (request.nextUrl.pathname.startsWith('/dashboard')) {
    if (!token) {
      return NextResponse.redirect(new URL('/login', request.url));
    }

    try {
      // Decode JWT to get user role
      // In a real scenario, consider verifying the token signature if not using an API-first approach,
      // but decoding the payload is standard for Next.js edge middleware.
      const decoded = jwtDecode<CustomJwtPayload>(token);
      const userRole = decoded.role;

      // Farmer trying to access investor dashboard
      if (request.nextUrl.pathname.startsWith('/dashboard/investor') && userRole !== 'investor') {
        const url = new URL('/dashboard/farmer', request.url);
        url.searchParams.set('error', 'unauthorized_role');
        return NextResponse.redirect(url);
      }

      // Investor trying to access farmer dashboard
      if (request.nextUrl.pathname.startsWith('/dashboard/farmer') && userRole !== 'farmer') {
        const url = new URL('/dashboard/investor', request.url);
        url.searchParams.set('error', 'unauthorized_role');
        return NextResponse.redirect(url);
      }
      
      // If valid role or accessing general dashboard route, continue
      return NextResponse.next();
      
    } catch (error) {
      // Invalid token
      return NextResponse.redirect(new URL('/login', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
