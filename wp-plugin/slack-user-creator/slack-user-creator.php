<?php
/**
 * Plugin Name:       Slack User Creator Endpoint
 * Plugin URI:        https://github.com/vanya/slack-wp-integration
 * Description:       Кастомний REST API эндпоінт для безпечного створення користувачів WordPress із роллю administrator через Slack-бота.
 * Version:           1.0.0
 * Author:            Integration Developer
 * License:           GPL-2.0-or-later
 * Text Domain:       slack-user-creator
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

add_action( 'rest_api_init', 'suc_register_routes' );

function suc_register_routes() {
    register_rest_route(
        'slack-bot/v1',
        '/users',
        array(
            'methods'             => WP_REST_Server::CREATABLE,
            'callback'            => 'suc_handle_create_user',
            'permission_callback' => 'suc_check_permission',
        )
    );
}

function suc_get_secret_key() {
    if ( defined( 'SLACK_BOT_SECRET_KEY' ) && ! empty( SLACK_BOT_SECRET_KEY ) ) {
        return (string) SLACK_BOT_SECRET_KEY;
    }

    $env_secret = getenv( 'SLACK_BOT_SECRET_KEY' );
    if ( ! empty( $env_secret ) ) {
        return (string) $env_secret;
    }

    return null;
}

function suc_check_permission( WP_REST_Request $request ) {
    $configured_secret = suc_get_secret_key();

    if ( empty( $configured_secret ) ) {
        return new WP_Error(
            'server_misconfiguration',
            __( 'Секретний ключ не налаштовано на сервері WordPress (константа SLACK_BOT_SECRET_KEY відсутня).', 'slack-user-creator' ),
            array( 'status' => 500 )
        );
    }

    $provided_secret = $request->get_header( 'x-webhook-secret' );
    if ( empty( $provided_secret ) ) {
        $provided_secret = $request->get_header( 'x_webhook_secret' );
    }
    if ( empty( $provided_secret ) && isset( $_SERVER['HTTP_X_WEBHOOK_SECRET'] ) ) {
        $provided_secret = sanitize_text_field( wp_unslash( $_SERVER['HTTP_X_WEBHOOK_SECRET'] ) );
    }

    if ( empty( $provided_secret ) || ! hash_equals( $configured_secret, (string) $provided_secret ) ) {
        return new WP_Error(
            'unauthorized',
            __( 'Невірний або відсутній секретний ключ автентифікації.', 'slack-user-creator' ),
            array( 'status' => 401 )
        );
    }

    return true;
}

function suc_handle_create_user( WP_REST_Request $request ) {
    $params = $request->get_json_params();
    if ( empty( $params ) || ! is_array( $params ) ) {
        $params = $request->get_params();
    }

    $raw_username = isset( $params['username'] ) ? trim( (string) $params['username'] ) : '';
    $raw_email    = isset( $params['email'] ) ? trim( (string) $params['email'] ) : '';
    $raw_password = isset( $params['password'] ) ? (string) $params['password'] : '';

    if ( '' === $raw_username || '' === $raw_email || '' === $raw_password ) {
        return new WP_Error(
            'missing_parameters',
            __( 'Усі поля (username, email, password) є обов\'язковими для створення користувача.', 'slack-user-creator' ),
            array( 'status' => 400 )
        );
    }

    $username = sanitize_user( $raw_username, true );
    if ( ! validate_username( $username ) || ! preg_match( '/^[a-zA-Z0-9_.-]+$/', $username ) || $username !== $raw_username ) {
        return new WP_Error(
            'invalid_username',
            __( 'Некоректний логін користувача. Дозволені лише латинські літери, цифри, крапки, дефіси та підкреслення.', 'slack-user-creator' ),
            array( 'status' => 400 )
        );
    }

    $email = sanitize_email( $raw_email );
    if ( ! is_email( $email ) ) {
        return new WP_Error(
            'invalid_email',
            __( 'Некоректний формат email-адреси.', 'slack-user-creator' ),
            array( 'status' => 400 )
        );
    }

    if ( strlen( $raw_password ) < 8 ) {
        return new WP_Error(
            'weak_password',
            __( 'Пароль занадто короткий. Мінімальна довжина становить 8 символів.', 'slack-user-creator' ),
            array( 'status' => 400 )
        );
    }

    if ( username_exists( $username ) ) {
        return new WP_Error(
            'username_exists',
            __( 'Користувач із таким логіном уже зареєстрований.', 'slack-user-creator' ),
            array( 'status' => 409 )
        );
    }

    if ( email_exists( $email ) ) {
        return new WP_Error(
            'email_exists',
            __( 'Користувач із такою email-адресою вже зареєстрований.', 'slack-user-creator' ),
            array( 'status' => 409 )
        );
    }

    $user_data = array(
        'user_login'   => $username,
        'user_email'   => $email,
        'user_pass'    => $raw_password,
        'role'         => 'administrator',
        'display_name' => $username,
    );

    $user_id = wp_insert_user( $user_data );

    if ( is_wp_error( $user_id ) ) {
        return new WP_Error(
            'creation_failed',
            __( 'Не вдалося створити користувача через внутрішню помилку сервера WordPress.', 'slack-user-creator' ),
            array( 'status' => 500 )
        );
    }

    $response_data = array(
        'code'    => 'user_created',
        'message' => __( 'Користувача з роллю administrator успішно створено.', 'slack-user-creator' ),
        'data'    => array(
            'user_id'  => (int) $user_id,
            'username' => $username,
            'email'    => $email,
            'role'     => 'administrator',
        ),
    );

    return new WP_REST_Response( $response_data, 201 );
}
